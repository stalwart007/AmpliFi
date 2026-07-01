// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldSource} from "./Interfaces.sol";

/**
 * @title  YieldRouter
 * @notice Periphery that routes idle reserve into a governance-selected
 *         {IYieldSource} (Aave, an ERC-4626 / Ethena vault, …) and back. It is a
 *         SEPARATE contract from the vault on purpose: the audited vault
 *         accounting core is not modified. Governance/keeper deploys idle to
 *         yield and recalls it before it's needed; `deployedValue()` lets an
 *         integrated NAV include the yield position once that binding is audited.
 */
contract YieldRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    IYieldSource public source;

    event SourceUpdated(address source);
    event Deployed(uint256 amount);
    event Recalled(uint256 amount);

    error ZeroAddress();
    error AssetMismatch();

    constructor(address asset_, address owner_) Ownable(owner_) {
        if (asset_ == address(0)) revert ZeroAddress();
        asset = IERC20(asset_);
    }

    function setSource(IYieldSource s) external onlyOwner {
        if (address(s) == address(0)) revert ZeroAddress();
        if (s.asset() != address(asset)) revert AssetMismatch();
        source = s;
        emit SourceUpdated(address(s));
    }

    /// @notice Pull `amount` from the caller and deploy it into the yield source.
    function deploy(uint256 amount) external onlyOwner nonReentrant {
        if (address(source) == address(0)) revert ZeroAddress();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        asset.forceApprove(address(source), amount);
        source.deposit(amount);
        emit Deployed(amount);
    }

    /// @notice Withdraw `amount` of value from the source back to `to`.
    function recall(uint256 amount, address to) external onlyOwner nonReentrant {
        source.withdraw(amount, to);
        emit Recalled(amount);
    }

    function deployedValue() external view returns (uint256) {
        return address(source) == address(0) ? 0 : source.totalAssets();
    }
}
