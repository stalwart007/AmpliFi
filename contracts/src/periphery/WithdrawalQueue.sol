// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal view of the vault this queue redeems against (ERC-4626 subset).
interface IRedeemableVault {
    function asset() external view returns (address);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function previewRedeem(uint256 shares) external view returns (uint256 assets);
}

/**
 * @title  WithdrawalQueue
 * @notice FIFO queue for large redemptions. Instead of forcing the vault to
 *         liquidate its WHOLE option book on one big withdrawal (SECURITY_REVIEW
 *         finding #6), holders escrow their AFI shares here; a keeper processes
 *         the queue in order — redeeming against the vault as liquidity allows
 *         (e.g. after a scheduled book unwind) — and holders then claim their
 *         settled assets. Small redemptions still go straight through the vault.
 *
 * @dev    Shares are pulled into escrow on request, so the redemption is locked
 *         in at queue time and cannot be double-spent. Processing redeems the
 *         escrowed shares for assets held by this contract; claiming transfers
 *         the owed assets out. Reentrancy-guarded; keeper-gated processing.
 */
contract WithdrawalQueue is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    IRedeemableVault public immutable vault;
    IERC20 public immutable shareToken; // the vault's AFI shares
    IERC20 public immutable asset; // settlement asset (e.g. USDC)

    struct Request {
        address owner;
        uint256 shares;
        uint256 assets; // filled on processing
        bool processed;
        bool claimed;
    }

    Request[] public requests;
    uint256 public head; // next unprocessed index (FIFO)
    uint256 public totalPendingShares;

    error NothingToProcess();
    error NotOwner();
    error NotProcessed();
    error AlreadyClaimed();
    error ZeroShares();

    event Requested(uint256 indexed id, address indexed owner, uint256 shares);
    event Processed(uint256 indexed id, uint256 shares, uint256 assets);
    event Claimed(uint256 indexed id, address indexed owner, uint256 assets);

    constructor(IRedeemableVault _vault, address governor, address keeper) {
        vault = _vault;
        shareToken = IERC20(address(_vault)); // ERC-4626 vault is itself the share ERC20
        asset = IERC20(_vault.asset());
        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(KEEPER_ROLE, keeper);
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    /// @notice Escrow `shares` and join the queue. Requires prior share approval.
    function requestWithdrawal(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroShares();
        shareToken.safeTransferFrom(msg.sender, address(this), shares);
        id = requests.length;
        requests.push(Request({owner: msg.sender, shares: shares, assets: 0, processed: false, claimed: false}));
        totalPendingShares += shares;
        emit Requested(id, msg.sender, shares);
    }

    /**
     * @notice Process up to `count` queued requests FIFO, redeeming each against
     *         the vault for assets held here until claimed. Keeper-gated so it
     *         runs only when the vault has liquidity to honour the redemptions.
     */
    function process(uint256 count) external onlyRole(KEEPER_ROLE) nonReentrant returns (uint256 processed) {
        uint256 i = head;
        uint256 end = requests.length;
        while (processed < count && i < end) {
            Request storage rq = requests[i];
            if (!rq.processed) {
                uint256 assets = vault.redeem(rq.shares, address(this), address(this));
                rq.assets = assets;
                rq.processed = true;
                totalPendingShares -= rq.shares;
                emit Processed(i, rq.shares, assets);
                processed += 1;
            }
            i += 1;
        }
        head = i;
        if (processed == 0) revert NothingToProcess();
    }

    /// @notice Claim settled assets for a processed request.
    function claim(uint256 id) external nonReentrant returns (uint256 assets) {
        Request storage rq = requests[id];
        if (rq.owner != msg.sender) revert NotOwner();
        if (!rq.processed) revert NotProcessed();
        if (rq.claimed) revert AlreadyClaimed();
        rq.claimed = true;
        assets = rq.assets;
        asset.safeTransfer(rq.owner, assets);
        emit Claimed(id, rq.owner, assets);
    }

    /// @notice Convenience: assets a request would be owed at the current NAV.
    function previewRequest(uint256 id) external view returns (uint256) {
        Request storage rq = requests[id];
        if (rq.processed) return rq.assets;
        return vault.previewRedeem(rq.shares);
    }
}
