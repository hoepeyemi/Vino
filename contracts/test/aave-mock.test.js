const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Mock Aave integration", function () {
  it("supplies and withdraws through the mock pool", async function () {
    const [owner] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    const MockAaveV3Pool = await ethers.getContractFactory("MockAaveV3Pool");
    const AaveV3YieldSource = await ethers.getContractFactory("AaveV3YieldSource");

    const token = await MockToken.deploy();
    await token.waitForDeployment();

    const pool = await MockAaveV3Pool.deploy();
    await pool.waitForDeployment();

    const liquidityRate = 25000000000000000000000000n;
    await pool.registerAsset(await token.getAddress(), "Mock Aave Token", "maMOCK", liquidityRate);

    const yieldSource = await AaveV3YieldSource.deploy(await pool.getAddress());
    await yieldSource.waitForDeployment();
    await yieldSource.setAuthorizedVault(owner.address);

    const amount = ethers.parseEther("100");
    await token.approve(await yieldSource.getAddress(), amount);

    await expect(yieldSource.deposit(1, await token.getAddress(), amount)).to.not.be.reverted;

    const reserve = await pool.getReserveData(await token.getAddress());
    expect(reserve.aTokenAddress).to.equal(await pool.getAToken(await token.getAddress()));
    expect(await yieldSource.getCurrentAPY(await token.getAddress())).to.equal(250n);
    expect(await yieldSource.getCurrentYield(1)).to.equal(0n);

    const position = await yieldSource.getPosition(1);
    expect(position.asset).to.equal(await token.getAddress());
    expect(position.principal).to.equal(amount);
    expect(position.currentValue).to.equal(amount);

    await expect(yieldSource.withdraw(1, owner.address)).to.not.be.reverted;
    expect(await token.balanceOf(owner.address)).to.equal(ethers.parseEther("1000000"));
    expect(await yieldSource.getCurrentYield(1)).to.equal(0n);
  });
});
