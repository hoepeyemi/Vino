const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PythOracle", function () {
  let oracle;
  let mockPyth;
  const nativeFeed = ethers.keccak256(ethers.toUtf8Bytes("MON/USD"));

  beforeEach(async function () {
    const MockPyth = await ethers.getContractFactory("MockPyth");
    mockPyth = await MockPyth.deploy();
    await mockPyth.waitForDeployment();
    await mockPyth.setPrice(nativeFeed, 200000000000n);

    const PythOracle = await ethers.getContractFactory("PythOracle");
    oracle = await PythOracle.deploy(await mockPyth.getAddress(), nativeFeed);
    await oracle.waitForDeployment();
  });

  it("reads prices and supports fallback mode", async function () {
    expect(await oracle.getEthUsdPrice()).to.equal(200000000000n);
    expect(await oracle.getNativeUsdPrice()).to.equal(200000000000n);
    expect(await oracle.isPythAvailable()).to.equal(true);

    await oracle.activateFallback("Testing fallback");
    expect(await oracle.useFallback()).to.equal(true);
    expect(await oracle.getEthUsdPrice()).to.equal(200000000000n);

    await oracle.setFallbackPrice(300000000000);
    expect(await oracle.getEthUsdPrice()).to.equal(300000000000n);

    await oracle.deactivateFallback();
    expect(await oracle.useFallback()).to.equal(false);
  });

  it("falls back when Pyth reverts", async function () {
    await mockPyth.setShouldRevert(true);
    expect(await oracle.getEthUsdPrice()).to.equal(200000000000n);
    expect(await oracle.getNativeUsdPrice()).to.equal(200000000000n);
    expect(await oracle.isPythAvailable()).to.equal(false);
  });
});
