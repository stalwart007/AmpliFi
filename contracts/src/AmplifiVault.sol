// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IOptionsVenue} from "./interfaces/IOptionsVenue.sol";
import {RiskController} from "./RiskController.sol";

/**
 * @title  AmplifiVault (the AFI share token)
 * @notice ERC-4626 vault for the AmpliFi leveraged, capped-downside synthetic
 *         index. Users deposit a reserve asset (e.g. USDC) and receive AFI
 *         shares. A configurable fraction of each deposit is routed to an
 *         external `IOptionsVenue` as option premium, which manufactures the
 *         leveraged, capped-downside exposure. **The vault never invents
 *         returns** — its NAV is `idle reserve + venue.markToMarket()`, and the
 *         book value the venue reports for a long-option book is always ≥ 0,
 *         which is the on-chain expression of the capped-downside guarantee.
 *
 * @dev    Security posture:
 *           - Role-based access (no single owner key for strategy ops):
 *             GOVERNOR sets policy, KEEPER pokes NAV / harvests, ADMIN manages roles.
 *           - ReentrancyGuard on all asset-moving externals.
 *           - Pausable emergency stop; deposits independently haltable on wind-down.
 *           - Deposit cap to bound exposure during guarded launch.
 *           - Portfolio-level wind-down via the RiskController (not per-asset
 *             liquidation).
 *
 *         AUDIT STATUS: this contract is written to production standards and
 *         compiles clean, but mainnet custody of real funds requires an
 *         independent audit and a live venue adapter. See PRODUCTION_READINESS.md.
 */
contract AmplifiVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERF_FEE_BPS = 2_000; // hard cap: 20%

    IOptionsVenue public venue;
    RiskController public immutable riskController;

    address public treasury;
    uint256 public premiumBps; // share of each deposit routed to the venue as premium
    uint256 public perfFeeBps; // high-water-mark performance fee
    uint256 public depositCap; // max total assets (0 = uncapped)
    uint256 public lastFeeNavWad; // HWM used for performance-fee crystallisation
    bool public depositsHalted; // latched on wind-down; redemptions stay open

    /// @notice Minimum manufactured notional as a multiple of premium, in bps
    ///         (10_000 = 1×). Threaded into `venue.openExposure` as the slippage
    ///         floor so premium is never deployed for less than this notional.
    uint256 public minExposureBps = 10_000;

    /// @notice Minimum size of the FIRST deposit (when totalSupply == 0). Together
    ///         with OZ v5's virtual shares/assets this neutralises the ERC-4626
    ///         first-depositor inflation/donation attack (finding #5): the attacker
    ///         can no longer seed the vault with dust and then skew the rate.
    uint256 public minFirstDeposit;

    /// @notice Venues that governance has explicitly approved as `setVenue`
    ///         targets. The initial venue is trusted at construction; any later
    ///         repoint must be allowlisted first (ideally via the timelock).
    mapping(address => bool) public venueAllowed;

    error ZeroAddress();
    error BadParam();
    error CapExceeded();
    error DepositsHalted();
    error VenueNotAllowed();
    error AssetMismatch();

    event VenueUpdated(address venue);
    event VenueAllowlisted(address venue, bool allowed);
    event MinExposureBpsUpdated(uint256 bps);
    event TreasuryUpdated(address treasury);
    event PremiumBpsUpdated(uint256 bps);
    event PerfFeeUpdated(uint256 bps);
    event DepositCapUpdated(uint256 cap);
    event PremiumDeployed(uint256 premium, uint256 notional);
    event PerformanceFee(uint256 feeAssets, uint256 feeShares, uint256 navWad);
    event WoundDown(uint256 navWad, uint256 proceeds);
    /// @notice Emitted on every keeper NAV poke — the canonical checkpoint
    ///         off-chain analytics/keeper reconcile against (parity with
    ///         strategy-core's epoch marks).
    event NavPoked(uint256 navWad, bool woundDown);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address governor,
        address keeper,
        IOptionsVenue venue_,
        RiskController riskController_,
        address treasury_,
        uint256 premiumBps_,
        uint256 perfFeeBps_,
        uint256 depositCap_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (
            governor == address(0) ||
            keeper == address(0) ||
            address(venue_) == address(0) ||
            address(riskController_) == address(0) ||
            treasury_ == address(0)
        ) revert ZeroAddress();
        if (premiumBps_ > BPS || perfFeeBps_ > MAX_PERF_FEE_BPS) revert BadParam();

        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
        _grantRole(KEEPER_ROLE, keeper);

        venue = venue_;
        riskController = riskController_;
        treasury = treasury_;
        premiumBps = premiumBps_;
        perfFeeBps = perfFeeBps_;
        depositCap = depositCap_;
        lastFeeNavWad = 1e18;
        minFirstDeposit = 10 ** IERC20Metadata(address(asset_)).decimals(); // ≥ 1 whole asset unit
    }

    // -------------------------------------------------------------------------
    // NAV: idle reserve + external book value. The vault never fabricates this.
    // -------------------------------------------------------------------------

    function totalAssets() public view override returns (uint256) {
        return _idle() + venue.markToMarket();
    }

    function _idle() internal view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice NAV per share in 1e18 fixed point (par = 1e18 at genesis).
    function navPerShareWad() public view returns (uint256) {
        uint256 ts = totalSupply();
        return ts == 0 ? 1e18 : totalAssets().mulDiv(1e18, ts);
    }

    // -------------------------------------------------------------------------
    // Deposit caps & halts
    // -------------------------------------------------------------------------

    function maxDeposit(address) public view override returns (uint256) {
        if (paused() || depositsHalted) return 0;
        if (depositCap == 0) return type(uint256).max;
        uint256 ta = totalAssets();
        return ta >= depositCap ? 0 : depositCap - ta;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assetsAllowed = maxDeposit(receiver);
        return assetsAllowed == type(uint256).max ? type(uint256).max : previewDeposit(assetsAllowed);
    }

    // -------------------------------------------------------------------------
    // Deposit / withdraw hooks: route premium to the venue, settle on shortfall.
    // -------------------------------------------------------------------------

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        virtual
        override
        nonReentrant
        whenNotPaused
    {
        if (depositsHalted) revert DepositsHalted();
        if (depositCap != 0 && totalAssets() + assets > depositCap) revert CapExceeded();
        // First-depositor inflation guard (finding #5): the opening deposit must
        // be at least `minFirstDeposit`, so the vault can't be seeded with dust.
        if (totalSupply() == 0 && assets < minFirstDeposit) revert BadParam();

        super._deposit(caller, receiver, assets, shares); // pulls assets, mints shares

        uint256 premium = assets.mulDiv(premiumBps, BPS);
        if (premium > 0) {
            IERC20(asset()).safeTransfer(address(venue), premium);
            // Slippage floor: require the venue to manufacture at least
            // `minExposureBps` of premium in notional, instead of accepting any
            // amount (finding #7). A keeper can pass a tighter floor off-chain.
            uint256 minExposure = premium.mulDiv(minExposureBps, BPS);
            uint256 notional = venue.openExposure(premium, minExposure);
            emit PremiumDeployed(premium, notional);
        }
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        // Ensure enough idle reserve to honour the withdrawal; settle the book
        // if the reserve is short. (Reference policy: settle-all-then-redeploy is
        // intentionally simple; a production keeper would unwind only the needed
        // slice. The capped-downside invariant holds regardless.)
        uint256 idle = _idle();
        if (idle < assets) {
            uint256 proceeds = venue.settle();
            emit WoundDown(navPerShareWad(), proceeds);
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // -------------------------------------------------------------------------
    // Keeper operations: NAV poke (risk + fee) and book redeployment.
    // -------------------------------------------------------------------------

    /**
     * @notice Crystallise the performance fee on new NAV highs and feed the
     *         RiskController; on a floor breach, latch deposits-halted and
     *         settle the book to the reserve (portfolio-level wind-down).
     */
    function pokeNav() external onlyRole(KEEPER_ROLE) nonReentrant returns (bool woundDown) {
        uint256 navWad = navPerShareWad();
        _crystalliseFee(navWad);

        woundDown = riskController.pokeNav(navWad);
        if (woundDown && !depositsHalted) {
            depositsHalted = true;
            uint256 proceeds = venue.settle();
            emit WoundDown(navWad, proceeds);
        }
        emit NavPoked(navWad, woundDown);
    }

    function _crystalliseFee(uint256 navWad) internal {
        uint256 ts = totalSupply();
        if (perfFeeBps == 0 || ts == 0 || navWad <= lastFeeNavWad) {
            if (navWad > lastFeeNavWad) lastFeeNavWad = navWad;
            return;
        }
        uint256 gainPerShareWad = navWad - lastFeeNavWad;
        uint256 feeAssets = gainPerShareWad.mulDiv(ts, 1e18).mulDiv(perfFeeBps, BPS);
        if (feeAssets > 0) {
            uint256 feeShares = previewDeposit(feeAssets);
            if (feeShares > 0) _mint(treasury, feeShares);
            emit PerformanceFee(feeAssets, feeShares, navWad);
        }
        lastFeeNavWad = navWad;
    }

    /// @notice Redeploy idle reserve into the venue as fresh premium (keeper).
    function deployIdle(uint256 amount, uint256 minExposure) external onlyRole(KEEPER_ROLE) nonReentrant {
        if (amount == 0 || amount > _idle()) revert BadParam();
        IERC20(asset()).safeTransfer(address(venue), amount);
        uint256 notional = venue.openExposure(amount, minExposure);
        emit PremiumDeployed(amount, notional);
    }

    // -------------------------------------------------------------------------
    // Governance
    // -------------------------------------------------------------------------

    /// @notice Governance pre-approves a venue before it can become the active
    ///         venue. Put GOVERNOR_ROLE behind the timelock so this has a delay.
    function allowVenue(address v, bool allowed) external onlyRole(GOVERNOR_ROLE) {
        if (v == address(0)) revert ZeroAddress();
        venueAllowed[v] = allowed;
        emit VenueAllowlisted(v, allowed);
    }

    function setVenue(IOptionsVenue v) external onlyRole(GOVERNOR_ROLE) {
        if (address(v) == address(0)) revert ZeroAddress();
        // A repoint must target a pre-allowlisted venue whose settlement asset
        // matches this vault's — closes the "repoint to a malicious venue" vector
        // (finding #2).
        if (!venueAllowed[address(v)]) revert VenueNotAllowed();
        if (v.asset() != asset()) revert AssetMismatch();
        venue = v;
        emit VenueUpdated(address(v));
    }

    function setMinExposureBps(uint256 bps) external onlyRole(GOVERNOR_ROLE) {
        minExposureBps = bps;
        emit MinExposureBpsUpdated(bps);
    }

    function setMinFirstDeposit(uint256 amount) external onlyRole(GOVERNOR_ROLE) {
        minFirstDeposit = amount;
    }

    function setTreasury(address t) external onlyRole(GOVERNOR_ROLE) {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    function setPremiumBps(uint256 bps) external onlyRole(GOVERNOR_ROLE) {
        if (bps > BPS) revert BadParam();
        premiumBps = bps;
        emit PremiumBpsUpdated(bps);
    }

    function setPerfFeeBps(uint256 bps) external onlyRole(GOVERNOR_ROLE) {
        if (bps > MAX_PERF_FEE_BPS) revert BadParam();
        perfFeeBps = bps;
        emit PerfFeeUpdated(bps);
    }

    function setDepositCap(uint256 cap) external onlyRole(GOVERNOR_ROLE) {
        depositCap = cap;
        emit DepositCapUpdated(cap);
    }

    /// @notice Governor reopens deposits after a wind-down + epoch reset.
    function resumeDeposits() external onlyRole(GOVERNOR_ROLE) {
        depositsHalted = false;
    }

    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------------------

    function decimals() public view override(ERC4626) returns (uint8) {
        return ERC4626.decimals();
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
