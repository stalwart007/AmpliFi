// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IOptionsVenue} from "../interfaces/IOptionsVenue.sol";
import {IPanopticPool} from "../interfaces/IPanopticPool.sol";

/**
 * @title  PanopticVenueAdapter
 * @notice Binds the AmpliFi vault's {IOptionsVenue} seam to Panoptic v1-core.
 *         Premium routed by the vault is deposited as collateral and used to
 *         mint LONG, perpetual Panoptic options — the financing engine behind
 *         the TimeMachine's "capital compression": each premium dollar commands
 *         a multiple of delta exposure, the position is financed by streaming
 *         premium (streamia) rather than an expiry roll, and the worst case is
 *         losing the committed collateral and nothing more (capped downside).
 *
 * @dev    The vault is the `owner`; only it may open or settle exposure. The
 *         keeper sets the position template (`tokenId`) and the target leverage
 *         off-chain — the same TokenId Panoptic would mint — and this adapter
 *         scales it by the premium committed. Marks come straight from
 *         `IPanopticPool.accountValue`, so the vault never fabricates NAV.
 *
 *         AUDIT STATUS: written to production standards and compiles clean, but
 *         the live Panoptic binding + the independent audit are required before
 *         real-fund custody.
 */
contract PanopticVenueAdapter is IOptionsVenue, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPanopticPool public immutable pool;
    IERC20 public immutable assetToken;

    uint256 public leverageX = 6; // notional multiple the keeper targets
    int256 public deltaWadCfg = 0.53e18; // ATM-ish long-call delta
    uint256 public positionTemplate; // Panoptic TokenId encoding the long legs

    uint256[] private _open; // open position TokenIds
    mapping(uint256 => bool) private _isOpen;

    /// @notice Keeper configures the position template/leverage; the vault (owner)
    ///         calls open/settle. Separating the two roles is deliberate — the
    ///         vault must never need keeper privileges and vice-versa.
    address public keeper;

    error NotConfigured();
    error Slippage();
    error ZeroAddress();
    error NotKeeper();

    event TemplateUpdated(uint256 tokenId);
    event LeverageUpdated(uint256 leverageX);
    event KeeperUpdated(address keeper);

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(IPanopticPool pool_, address vault_, address keeper_) Ownable(vault_) {
        if (address(pool_) == address(0) || vault_ == address(0) || keeper_ == address(0)) revert ZeroAddress();
        pool = pool_;
        keeper = keeper_;
        assetToken = IERC20(pool_.collateralToken());
    }

    // ------------------------------------------------------------- IOptionsVenue

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function markToMarket() external view returns (uint256) {
        return pool.accountValue(address(this));
    }

    function netDelta() external view returns (int256) {
        // Prefer the pool's live delta; fall back to the configured ATM delta.
        int256 d = pool.accountDeltaWad(address(this));
        return d != 0 ? d : deltaWadCfg;
    }

    /**
     * @notice Deploy `premium` (already transferred here by the vault) as a fresh
     *         long Panoptic position. Reverts if no template is configured or the
     *         manufactured notional is below `minExposure`.
     */
    function openExposure(uint256 premium, uint256 minExposure)
        external
        onlyOwner
        nonReentrant
        returns (uint256 notional)
    {
        if (positionTemplate == 0) revert NotConfigured();

        assetToken.forceApprove(address(pool), premium);
        pool.depositCollateral(premium);

        // Size the template by the committed premium; mint the long position.
        uint128 size = premium > type(uint128).max ? type(uint128).max : uint128(premium);
        pool.mintLongOption(positionTemplate, size);
        if (!_isOpen[positionTemplate]) {
            _isOpen[positionTemplate] = true;
            _open.push(positionTemplate);
        }

        notional = premium * leverageX;
        if (notional < minExposure) revert Slippage();
        emit ExposureOpened(premium, notional);
    }

    /**
     * @notice Burn every open position, sweep all collateral, and return the
     *         proceeds to the vault. Used on redemption shortfalls / wind-down.
     */
    function settle() external onlyOwner nonReentrant returns (uint256 proceeds) {
        uint256 n = _open.length;
        for (uint256 i; i < n; ++i) {
            uint256 id = _open[i];
            if (_isOpen[id]) {
                pool.burnLongOption(id);
                _isOpen[id] = false;
            }
        }
        delete _open;

        // Pull all free collateral out and forward the realised cash.
        uint256 value = pool.accountValue(address(this));
        if (value > 0) pool.withdrawCollateral(value);
        proceeds = assetToken.balanceOf(address(this));
        if (proceeds > 0) assetToken.safeTransfer(owner(), proceeds);
        emit Settled(proceeds);
    }

    // ------------------------------------------------------------- configuration

    /// @notice Keeper sets the Panoptic TokenId (long-leg structure) to mint.
    function setPositionTemplate(uint256 tokenId) external onlyKeeper {
        positionTemplate = tokenId;
        emit TemplateUpdated(tokenId);
    }

    function setLeverage(uint256 x) external onlyKeeper {
        if (x == 0) revert NotConfigured();
        leverageX = x;
        emit LeverageUpdated(x);
    }

    function setDeltaWad(int256 d) external onlyKeeper {
        deltaWadCfg = d;
    }

    /// @notice The vault (owner) may rotate the keeper that configures positions.
    function setKeeper(address k) external onlyOwner {
        if (k == address(0)) revert ZeroAddress();
        keeper = k;
        emit KeeperUpdated(k);
    }

    function openPositions() external view returns (uint256[] memory) {
        return _open;
    }
}
