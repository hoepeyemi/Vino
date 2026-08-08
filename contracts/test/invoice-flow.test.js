const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCoreContracts, getEventArgs, increaseTime } = require("./helpers");

describe("Invoice flow", function () {
  it("mints, deposits, accrues yield, and withdraws", async function () {
    const { user1, invoiceNFT, yieldVault } = await deployCoreContracts();

    const dataCommitment = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const dueDate = now + 60 * 60 * 24 * 60;

    await expect(invoiceNFT.connect(user1).mint(dataCommitment, dataCommitment, dueDate))
      .to.emit(invoiceNFT, "InvoiceMinted");

    const tokenId = (await invoiceNFT.totalInvoices()) - 1n;

    await invoiceNFT.connect(user1).approve(await yieldVault.getAddress(), tokenId);
    await yieldVault.connect(user1).deposit(tokenId, 1, ethers.parseEther("10000"));

    const deposit = await yieldVault.getDeposit(tokenId);
    expect(deposit.active).to.equal(true);
    expect(deposit.strategy).to.equal(1n);

    await increaseTime(60 * 60 * 24 * 30);
    const accruedYield = await yieldVault.getAccruedYield(tokenId);
    expect(accruedYield).to.be.greaterThan(0n);

    await yieldVault.connect(user1).withdraw(tokenId);
    expect(await invoiceNFT.ownerOf(tokenId)).to.equal(user1.address);
  });

  it("records agent decisions and updates yield strategy", async function () {
    const { user1, agent, invoiceNFT, yieldVault, agentRouter } = await deployCoreContracts();

    const dataCommitment = ethers.keccak256(ethers.toUtf8Bytes("agent"));
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const dueDate = now + 60 * 60 * 24 * 90;

    await invoiceNFT.connect(user1).mint(dataCommitment, dataCommitment, dueDate);
    const tokenId = (await invoiceNFT.totalInvoices()) - 1n;
    await invoiceNFT.connect(user1).approve(await yieldVault.getAddress(), tokenId);
    await yieldVault.connect(user1).deposit(tokenId, 0, ethers.parseEther("10000"));

    await agentRouter.connect(agent).recordDecision(
      tokenId,
      2,
      85,
      "High confidence invoice with long duration, recommending aggressive strategy"
    );

    const decision = await agentRouter.getLatestDecision(tokenId);
    expect(decision.recommendedStrategy).to.equal(2n);
    expect(decision.confidence).to.equal(85n);
    expect(decision.executed).to.equal(true);

    const deposit = await yieldVault.getDeposit(tokenId);
    expect(deposit.strategy).to.equal(2n);
  });

  it("handles privacy commitments and oracle updates", async function () {
    const { user1, invoiceNFT, privacyRegistry, mockOracle } = await deployCoreContracts();

    const data = ethers.hexlify(ethers.toUtf8Bytes("secret_invoice_data"));
    const salt = ethers.zeroPadValue(ethers.toBeHex(999), 32);
    const commitment = ethers.keccak256(ethers.concat([data, salt]));

    const tx = await privacyRegistry.connect(user1).registerCommitment(commitment);
    const receipt = await tx.wait();
    const commitmentEvent = await getEventArgs(receipt, privacyRegistry, "CommitmentRegistered");
    const commitmentId = commitmentEvent.commitmentId ?? commitmentEvent[0];

    const storedCommitment = await privacyRegistry.getCommitment(commitmentId);
    expect(storedCommitment.commitment).to.equal(commitment);
    await expect(privacyRegistry.connect(user1).revealCommitment(commitmentId, data, salt))
      .to.emit(privacyRegistry, "CommitmentRevealed");

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await invoiceNFT.connect(user1).mint(commitment, commitment, now + 60 * 60 * 24 * 30);
    const tokenId = (await invoiceNFT.totalInvoices()) - 1n;
    await mockOracle.setRiskData(tokenId, 85, 92);

    expect(await mockOracle.getRiskScore(tokenId)).to.equal(85);
    expect(await mockOracle.getPaymentProbability(tokenId)).to.equal(92);
    const invoice = await invoiceNFT.getInvoice(tokenId);
    expect(invoice.riskScore).to.equal(85n);
    expect(invoice.paymentProbability).to.equal(92n);
  });
});
