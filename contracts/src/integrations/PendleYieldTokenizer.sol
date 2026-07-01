// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IYieldTokenizer} from "./Interfaces.sol";

/**
 * @title  PendleYieldTokenizer
 * @notice REFERENCE seam for Pendle: splitting a Standardized-Yield (SY) token
 *         into its Principal (PT) and Yield (YT) tokens so the protocol can lock
 *         in fixed yield (sell YT) or trade future yield. Pendle's real router
 *         (`mintPyFromSy` / `redeemPyToSy` with `TokenInput`/`ApproxParams`
 *         structs) is intricate; this seam captures the intent and holds the
 *         escrow. A production binding wires the concrete Pendle router in
 *         `_mint`/`_redeem`.
 */
contract PendleYieldTokenizer is IYieldTokenizer, Ownable {
    using SafeERC20 for IERC20;

    address public router; // Pendle Router V4

    event Tokenized(address syToken, uint256 amount, uint256 ptOut, uint256 ytOut);
    event Redeemed(uint256 amount, uint256 assetsOut);

    constructor(address router_, address owner_) Ownable(owner_) {
        router = router_;
    }

    function setRouter(address router_) external onlyOwner {
        router = router_;
    }

    function tokenize(address syToken, uint256 amount, address to)
        external
        onlyOwner
        returns (uint256 ptOut, uint256 ytOut)
    {
        IERC20(syToken).safeTransferFrom(msg.sender, address(this), amount);
        (ptOut, ytOut) = _mint(syToken, amount, to);
        emit Tokenized(syToken, amount, ptOut, ytOut);
    }

    function redeem(uint256 amount, address to) external onlyOwner returns (uint256 assetsOut) {
        assetsOut = _redeem(amount, to);
        emit Redeemed(amount, assetsOut);
    }

    /// @dev Production binding calls the Pendle router; reference returns 1:1.
    function _mint(address, uint256 amount, address) internal virtual returns (uint256, uint256) {
        return (amount, amount); // PT + YT notional == deposited SY at mint
    }

    function _redeem(uint256 amount, address) internal virtual returns (uint256) {
        return amount;
    }
}
