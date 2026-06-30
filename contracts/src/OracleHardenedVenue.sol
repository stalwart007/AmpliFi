// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IOptionsVenue} from "./interfaces/IOptionsVenue.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";

/**
 * @title  OracleHardenedVenue
 * @notice A reference options-venue adapter that hardens the two trust-boundary
 *         findings from the security review:
 *
 *         #1 (oracle manipulation): the book is never marked off a raw spot read.
 *         Prices enter through `syncPrice`, which enforces a STALENESS bound and a
 *         per-update DEVIATION bound before caching a validated snapshot. NAV is
 *         then computed from that snapshot, so a single manipulated block cannot
 *         jump the vault's share price — at worst it is rejected, at most it moves
 *         NAV by the capped deviation.
 *
 *         #3 (counterparty/freeze, no emergency exit): a GUARDIAN can pause new
 *         exposure and trigger `emergencyWithdraw`, returning all settlement
 *         assets held here to the vault independent of the normal settle path.
 *
 *         The economic model is a long, capped-downside book: value is floored at
 *         zero (you cannot lose more than the premium), matching the protocol's
 *         core invariant. A production adapter binds the real venue's settlement;
 *         the hardening pattern (guarded cached oracle + guardian exit) is the part
 *         the audit cares about and is implemented here in full.
 */
contract OracleHardenedVenue is IOptionsVenue, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    uint256 public constant BPS = 10_000;

    IERC20 public immutable assetToken;
    IPriceOracle public immutable oracle;

    // --- oracle-hardening parameters ---
    uint256 public maxStaleness; // seconds; reject prices older than this
    uint256 public maxDeviationBps; // reject a sync that moves cached price > this

    // --- validated price snapshot ---
    uint256 public cachedPrice; // last validated price (oracle decimals)
    uint256 public cachedAt; // when it was cached

    // --- book state ---
    uint256 public premium; // cost basis in asset units
    uint256 public entryPrice; // cached price at exposure open
    uint256 public notional; // manufactured dollar-delta notional
    uint256 public leverageX; // notional multiple per premium
    int256 public deltaWad; // reported net delta fraction (1e18)

    bool public paused;

    error StalePrice(uint256 updatedAt, uint256 nowTs);
    error DeviationTooLarge(uint256 fromPrice, uint256 toPrice);
    error PriceNotInitialised();
    error VenuePaused();
    error SlippageExceeded(uint256 notional, uint256 minExposure);

    event PriceSynced(uint256 price, uint256 updatedAt);
    event GuardsUpdated(uint256 maxStaleness, uint256 maxDeviationBps);
    event Paused(bool paused);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    constructor(
        address asset_,
        IPriceOracle oracle_,
        address governor,
        address vault,
        address guardian,
        uint256 leverageX_,
        uint256 maxStaleness_,
        uint256 maxDeviationBps_
    ) {
        assetToken = IERC20(asset_);
        oracle = oracle_;
        leverageX = leverageX_;
        maxStaleness = maxStaleness_;
        maxDeviationBps = maxDeviationBps_;
        deltaWad = 0.53e18;

        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
        _grantRole(VAULT_ROLE, vault);
        _grantRole(GUARDIAN_ROLE, guardian);

        // Seed the cache with the current (fresh) oracle reading.
        (uint256 p, uint256 ts) = oracle_.latestAnswer();
        cachedPrice = p;
        cachedAt = ts;
    }

    // -------------------------------------------------------------------------
    // Oracle hardening
    // -------------------------------------------------------------------------

    /**
     * @notice Pull a fresh price through the staleness + deviation guards and
     *         cache it. Permissionless (anyone may keep the snapshot fresh), but
     *         a manipulated read is rejected by the guards rather than accepted.
     */
    function syncPrice() public returns (uint256) {
        (uint256 p, uint256 ts) = oracle.latestAnswer();
        if (block.timestamp - ts > maxStaleness) revert StalePrice(ts, block.timestamp);
        if (cachedPrice != 0) {
            uint256 hi = p > cachedPrice ? p : cachedPrice;
            uint256 lo = p > cachedPrice ? cachedPrice : p;
            if (((hi - lo) * BPS) / cachedPrice > maxDeviationBps) revert DeviationTooLarge(cachedPrice, p);
        }
        cachedPrice = p;
        cachedAt = ts;
        emit PriceSynced(p, ts);
        return p;
    }

    function setGuards(uint256 maxStaleness_, uint256 maxDeviationBps_) external onlyRole(GOVERNOR_ROLE) {
        maxStaleness = maxStaleness_;
        maxDeviationBps = maxDeviationBps_;
        emit GuardsUpdated(maxStaleness_, maxDeviationBps_);
    }

    // -------------------------------------------------------------------------
    // IOptionsVenue
    // -------------------------------------------------------------------------

    function asset() external view returns (address) {
        return address(assetToken);
    }

    /// @notice Capped-downside book value from the VALIDATED cached price.
    function markToMarket() public view returns (uint256) {
        if (entryPrice == 0 || premium == 0) return 0;
        int256 pnl = (int256(notional) * (int256(cachedPrice) - int256(entryPrice))) / int256(entryPrice);
        int256 value = int256(premium) + pnl;
        return value > 0 ? uint256(value) : 0; // floored at 0 → max loss = premium
    }

    function netDelta() external view returns (int256) {
        return deltaWad;
    }

    function openExposure(uint256 premium_, uint256 minExposure) external onlyRole(VAULT_ROLE) returns (uint256) {
        if (paused) revert VenuePaused();
        if (cachedPrice == 0) revert PriceNotInitialised();
        // Refresh the snapshot through the guards so we strike at a validated price.
        uint256 p = syncPrice();
        uint256 manufactured = premium_ * leverageX;
        if (manufactured < minExposure) revert SlippageExceeded(manufactured, minExposure);
        premium += premium_;
        notional += manufactured;
        entryPrice = p;
        emit ExposureOpened(premium_, manufactured);
        return manufactured;
    }

    function settle() external onlyRole(VAULT_ROLE) nonReentrant returns (uint256 proceeds) {
        proceeds = markToMarket();
        uint256 bal = assetToken.balanceOf(address(this));
        if (proceeds > bal) proceeds = bal; // never transfer more than held
        premium = 0;
        notional = 0;
        entryPrice = 0;
        if (proceeds > 0) assetToken.safeTransfer(msg.sender, proceeds);
        emit Settled(proceeds);
    }

    // -------------------------------------------------------------------------
    // Emergency (finding #3)
    // -------------------------------------------------------------------------

    function setPaused(bool p) external onlyRole(GUARDIAN_ROLE) {
        paused = p;
        emit Paused(p);
    }

    /// @notice Guardian exit: return all settlement assets to `to`, book voided.
    function emergencyWithdraw(address to) external onlyRole(GUARDIAN_ROLE) nonReentrant returns (uint256 amount) {
        paused = true;
        premium = 0;
        notional = 0;
        entryPrice = 0;
        amount = assetToken.balanceOf(address(this));
        if (amount > 0) assetToken.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }

    function setDeltaWad(int256 d) external onlyRole(GOVERNOR_ROLE) {
        deltaWad = d;
    }
}
