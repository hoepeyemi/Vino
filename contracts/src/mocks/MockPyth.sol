// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

contract MockPyth {
    mapping(bytes32 => int64) public prices;
    bool public shouldRevert = false;

    function setEthPrice(int64 _price) external {
        prices[0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace] = _price;
    }

    function setPrice(bytes32 feedId, int64 _price) external {
        prices[feedId] = _price;
    }

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function getUpdateFee(bytes[] calldata) external pure returns (uint256) {
        return 0;
    }

    function updatePriceFeeds(bytes[] calldata) external payable {}

    function getPriceNoOlderThan(bytes32 id, uint256) external view returns (PythStructs.Price memory) {
        require(!shouldRevert, "Mock revert");

        int64 price = prices[id];
        if (price != 0) {
            return PythStructs.Price({price: price, conf: 1000000, expo: -8, publishTime: block.timestamp});
        }

        revert("Unknown price feed");
    }

    function getValidTimePeriod() external pure returns (uint256) {
        return 3600;
    }
}
