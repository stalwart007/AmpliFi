// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title  SignedPriceOracle
 * @notice A price feed whose VALUES are produced by a PRIVATE off-chain model and
 *         delivered on-chain as EIP-712-signed updates. The proprietary pricing
 *         logic — the "edge" — never touches the chain; only its signed *result*
 *         does. This gives genuine confidentiality of the model while keeping the
 *         on-chain code fully transparent and auditable (the opposite of
 *         obfuscation): anyone can verify HOW a price is accepted, no one can see
 *         WHY the signer chose it.
 *
 *         Guards, so a signed feed is still safe:
 *           - only the configured `signer` is trusted (EIP-712 recovery);
 *           - `nonce` is strictly increasing (replay protection);
 *           - the update timestamp cannot be in the future or older than
 *             `maxStaleness`;
 *           - a single update cannot move the price by more than
 *             `maxDeviationBps` (bounds a compromised-signer / fat-finger jump).
 *
 *         The consuming venue (`OracleHardenedVenue`) applies its OWN staleness +
 *         deviation checks on read, so this is defence-in-depth.
 *
 *         AUDIT STATUS: written to production standards, unaudited.
 */
contract SignedPriceOracle is IPriceOracle, Ownable, EIP712 {
    bytes32 private constant _UPDATE_TYPEHASH = keccak256("PriceUpdate(uint256 price,uint256 timestamp,uint256 nonce)");

    /// @notice The off-chain signer authorised to publish prices (holds the
    ///         private model). Rotate via `setSigner` behind the timelock.
    address public signer;
    uint8 public immutable priceDecimals;

    uint256 private _price;
    uint256 private _updatedAt;
    uint256 public nonce; // last accepted nonce (monotonic)

    uint256 public maxStaleness; // reject updates older than this (seconds)
    uint256 public maxDeviationBps; // max per-update move vs current price

    error BadSigner();
    error StaleUpdate(uint256 timestamp);
    error FutureUpdate(uint256 timestamp);
    error BadNonce(uint256 got, uint256 expected);
    error DeviationTooLarge(uint256 price, uint256 prev);
    error NoPrice();
    error ZeroAddress();

    event SignerUpdated(address signer);
    event BoundsUpdated(uint256 maxStaleness, uint256 maxDeviationBps);
    event PriceUpdated(uint256 price, uint256 timestamp, uint256 nonce);

    constructor(address owner_, address signer_, uint8 decimals_, uint256 maxStaleness_, uint256 maxDeviationBps_)
        Ownable(owner_)
        EIP712("AmpliFiSignedOracle", "1")
    {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        priceDecimals = decimals_;
        maxStaleness = maxStaleness_;
        maxDeviationBps = maxDeviationBps_;
    }

    // ----------------------------------------------------------------- config

    function setSigner(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        signer = s;
        emit SignerUpdated(s);
    }

    function setBounds(uint256 maxStaleness_, uint256 maxDeviationBps_) external onlyOwner {
        maxStaleness = maxStaleness_;
        maxDeviationBps = maxDeviationBps_;
        emit BoundsUpdated(maxStaleness_, maxDeviationBps_);
    }

    // ---------------------------------------------------------------- publish

    /**
     * @notice Publish a price signed by the off-chain model. Permissionless to
     *         call (a relayer/keeper), but only a valid `signer` signature is
     *         accepted — so the caller learns nothing about the model.
     */
    function submitPrice(uint256 price, uint256 timestamp, uint256 nonce_, bytes calldata signature) external {
        if (timestamp > block.timestamp) revert FutureUpdate(timestamp);
        if (block.timestamp - timestamp > maxStaleness) revert StaleUpdate(timestamp);
        if (nonce_ != nonce + 1) revert BadNonce(nonce_, nonce + 1);

        if (_updatedAt != 0 && maxDeviationBps != 0) {
            uint256 hi = _price > price ? _price : price;
            uint256 lo = _price > price ? price : _price;
            if ((hi - lo) * 10_000 > _price * maxDeviationBps) revert DeviationTooLarge(price, _price);
        }

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(_UPDATE_TYPEHASH, price, timestamp, nonce_)));
        if (ECDSA.recover(digest, signature) != signer) revert BadSigner();

        _price = price;
        _updatedAt = timestamp;
        nonce = nonce_;
        emit PriceUpdated(price, timestamp, nonce_);
    }

    /// @notice Helper exposing the typed digest the off-chain signer must sign.
    function hashUpdate(uint256 price, uint256 timestamp, uint256 nonce_) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(_UPDATE_TYPEHASH, price, timestamp, nonce_)));
    }

    // ------------------------------------------------------------- IPriceOracle

    function latestAnswer() external view returns (uint256, uint256) {
        if (_updatedAt == 0) revert NoPrice();
        return (_price, _updatedAt);
    }

    function decimals() external view returns (uint8) {
        return priceDecimals;
    }
}
