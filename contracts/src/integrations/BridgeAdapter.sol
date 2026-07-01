// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IBridgeAdapter} from "./Interfaces.sol";

/**
 * @title  BridgeAdapter
 * @notice REFERENCE cross-chain seam. Escrows the token and emits a bridge
 *         intent; a production implementation calls the concrete messenger in
 *         `_dispatch` — e.g. Circle CCTP `TokenMessenger.depositForBurn(...)` for
 *         canonical USDC, or a LayerZero OFT `send(...)`. Kept as a seam because
 *         a live bridge binding needs the real endpoint + an audit of the
 *         message-passing trust assumptions (bridges are a top exploit vector).
 */
contract BridgeAdapter is IBridgeAdapter, Ownable {
    using SafeERC20 for IERC20;

    address public endpoint; // CCTP TokenMessenger / LayerZero endpoint

    event BridgeInitiated(address token, uint256 amount, uint32 dstChainId, address recipient);
    event EndpointUpdated(address endpoint);

    error ZeroAddress();

    constructor(address endpoint_, address owner_) Ownable(owner_) {
        endpoint = endpoint_;
    }

    function setEndpoint(address endpoint_) external onlyOwner {
        endpoint = endpoint_;
        emit EndpointUpdated(endpoint_);
    }

    function quoteFee(uint32, uint256) external pure returns (uint256) {
        return 0; // messenger-specific; overridden by the concrete binding
    }

    function bridge(address token, uint256 amount, uint32 dstChainId, address recipient, bytes calldata options)
        external
        payable
        onlyOwner
    {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _dispatch(token, amount, dstChainId, recipient, options);
        emit BridgeInitiated(token, amount, dstChainId, recipient);
    }

    /// @dev Production binding replaces this with the real messenger call.
    function _dispatch(address, uint256, uint32, address, bytes calldata) internal virtual {
        if (endpoint == address(0)) revert ZeroAddress();
        // e.g. ITokenMessenger(endpoint).depositForBurn(amount, dstDomain, bytes32(recipient), token);
    }
}
