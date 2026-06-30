// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IPanopticPool} from "../interfaces/IPanopticPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  MockPanopticPool
 * @notice TEST / TESTNET ONLY. Implements the {IPanopticPool} seam so the
 *         {PanopticVenueAdapter} and the vault accounting can be exercised
 *         end-to-end without deploying real Panoptic + Uniswap V3. `setMarkBps`
 *         scales committed-position value to simulate market P&L.
 */
contract MockPanopticPool is IPanopticPool {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address => uint256) public freeCollateral;
    mapping(address => uint256) public committed;
    mapping(address => int256) public delta;
    uint256 public markBps = 10_000; // 100% = no P&L

    constructor(address token_) {
        token = IERC20(token_);
    }

    function collateralToken() external view returns (address) {
        return address(token);
    }

    function depositCollateral(uint256 assets) external returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), assets);
        freeCollateral[msg.sender] += assets;
        return assets;
    }

    function withdrawCollateral(uint256 assets) external returns (uint256 withdrawn) {
        withdrawn = assets > freeCollateral[msg.sender] ? freeCollateral[msg.sender] : assets;
        freeCollateral[msg.sender] -= withdrawn;
        if (withdrawn > 0) token.safeTransfer(msg.sender, withdrawn);
    }

    function mintLongOption(uint256, uint128 positionSize) external {
        uint256 s = uint256(positionSize);
        if (s > freeCollateral[msg.sender]) s = freeCollateral[msg.sender];
        freeCollateral[msg.sender] -= s;
        committed[msg.sender] += s;
        delta[msg.sender] = 0.53e18;
    }

    function burnLongOption(uint256) external returns (uint256 proceeds) {
        proceeds = (committed[msg.sender] * markBps) / 10_000;
        committed[msg.sender] = 0;
        freeCollateral[msg.sender] += proceeds; // realised value returns to free collateral
    }

    function accountValue(address account) external view returns (uint256) {
        return freeCollateral[account] + (committed[account] * markBps) / 10_000;
    }

    function accountDeltaWad(address account) external view returns (int256) {
        return delta[account];
    }

    // --- test control --------------------------------------------------------
    function setMarkBps(uint256 bps) external {
        markBps = bps;
    }
}
