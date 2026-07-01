// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IYieldSource} from "./Interfaces.sol";

/**
 * @title  ERC4626YieldSource
 * @notice REFERENCE adapter over ANY external ERC-4626 vault — which covers a
 *         large slice of the requested integrations at once: **Ethena** (sUSDe
 *         is an ERC-4626 staking vault over USDe), Morpho/MetaMorpho, Yearn v3,
 *         and any 4626-compliant vault. Idle reserve is deposited for shares;
 *         value tracks `convertToAssets(shares)`.
 *
 *         Unaudited reference wiring; bind a real 4626 vault only after audit.
 */
contract ERC4626YieldSource is IYieldSource, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC4626 public immutable vault;
    IERC20 public immutable underlying;

    error ZeroAddress();

    constructor(IERC4626 vault_, address owner_) Ownable(owner_) {
        if (address(vault_) == address(0)) revert ZeroAddress();
        vault = vault_;
        underlying = IERC20(vault_.asset());
    }

    function asset() external view returns (address) {
        return address(underlying);
    }

    function totalAssets() external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }

    function deposit(uint256 assets) external onlyOwner nonReentrant returns (uint256 shares) {
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        underlying.forceApprove(address(vault), assets);
        shares = vault.deposit(assets, address(this));
    }

    function withdraw(uint256 assets, address to) external onlyOwner nonReentrant returns (uint256) {
        return vault.withdraw(assets, to, address(this));
    }
}
