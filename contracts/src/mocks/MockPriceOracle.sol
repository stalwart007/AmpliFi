// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @notice TEST / TESTNET ONLY price feed whose value and timestamp are settable.
contract MockPriceOracle is IPriceOracle {
    uint256 public price;
    uint256 public updatedAt;
    uint8 public immutable dec;

    constructor(uint256 initialPrice, uint8 _decimals) {
        price = initialPrice;
        updatedAt = block.timestamp;
        dec = _decimals;
    }

    function latestAnswer() external view returns (uint256, uint256) {
        return (price, updatedAt);
    }

    function decimals() external view returns (uint8) {
        return dec;
    }

    function setPrice(uint256 newPrice) external {
        price = newPrice;
        updatedAt = block.timestamp;
    }

    /// @dev set a price with an explicit (possibly stale) timestamp, for tests.
    function setPriceAt(uint256 newPrice, uint256 ts) external {
        price = newPrice;
        updatedAt = ts;
    }
}
