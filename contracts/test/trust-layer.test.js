const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Trust layer", function () {
  let token;
  let staking;
  let confirmation;
  let owner;
  let issuer;
  let reporter;
  let buyer;

  beforeEach(async function () {
    [owner, issuer, reporter] = await ethers.getSigners();
    buyer = new ethers.Wallet(
      "0x59c6995e998f97a5a0044966f094538e5a0d7f9f2c2f0d9b8a6d4f3c2b1a0911",
      ethers.provider
    );

    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    token = await MockTokenFactory.deploy();
    await token.waitForDeployment();

    const ReputationStaking = await ethers.getContractFactory("ReputationStaking");
    staking = await ReputationStaking.deploy(await token.getAddress());
    await staking.waitForDeployment();

    const BuyerConfirmation = await ethers.getContractFactory("BuyerConfirmation");
    confirmation = await BuyerConfirmation.deploy();
    await confirmation.waitForDeployment();

    await token.mint(issuer.address, ethers.parseEther("100000"));
    await staking.setAuthorizedReporter(reporter.address, true);
    await owner.sendTransaction({
      to: buyer.address,
      value: ethers.parseEther("1"),
    });
  });

  it("stakes, records invoice activity, and slashes fraud", async function () {
    await token.connect(issuer).approve(await staking.getAddress(), ethers.parseEther("1000"));
    await staking.connect(issuer).stake(ethers.parseEther("1000"));

    expect((await staking.getProfile(issuer.address)).active).to.equal(true);
    expect(await staking.canMintInvoice(issuer.address, ethers.parseEther("5000"))).to.equal(true);

    await staking.connect(reporter).recordInvoiceIssued(issuer.address, 1, ethers.parseEther("5000"));
    await staking.connect(reporter).recordPayment(issuer.address, 1);
    expect((await staking.getProfile(issuer.address)).invoicesPaid).to.equal(1n);

    const expectedSlash = (ethers.parseEther("1000") * 5000n) / 10000n;
    await staking.connect(reporter).slashForFraud(issuer.address, 1);

    const profile = await staking.getProfile(issuer.address);
    expect(profile.stakedAmount).to.equal(ethers.parseEther("1000") - expectedSlash);
    expect(profile.fraudPenalties).to.equal(1n);
  });

  it("confirms invoices and records payment status", async function () {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const dueDate = now + 60 * 60 * 24 * 30;
    const amount = ethers.parseEther("10000");
    const invoiceId = 1n;
    const chainId = BigInt((await ethers.provider.getNetwork()).chainId);

    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "uint256", "address", "uint256"],
      [invoiceId, amount, dueDate, issuer.address, chainId]
    );
    const signature = await buyer.signMessage(ethers.getBytes(messageHash));
    expect(ethers.verifyMessage(ethers.getBytes(messageHash), signature)).to.equal(buyer.address);

    await confirmation.connect(buyer).confirmInvoice(invoiceId, amount, dueDate, issuer.address, signature);
    const conf = await confirmation.getConfirmation(invoiceId);
    expect(conf.buyer).to.equal(buyer.address);
    expect(conf.amount).to.equal(amount);
    expect(conf.dueDate).to.equal(BigInt(dueDate));
    expect(conf.paid).to.equal(false);

    await confirmation.setPaymentOracle(reporter.address, true);
    await confirmation.connect(reporter).recordPayment(invoiceId, amount);
    expect((await confirmation.getConfirmation(invoiceId)).paid).to.equal(true);
  });
});
