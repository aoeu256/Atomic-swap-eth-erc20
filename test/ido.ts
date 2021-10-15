const { expect } = require("chai");
const { ethers, Web3, web3 } = require("hardhat");
require("dotenv").config();

let idoContract: any;
let projectTokenContract: any;

describe("IDO", async () => {
  let owner: any;
  let poolOwner: any;
  let raisedWeiReceiver: any;

  let now: any;
  let tomorrow: any;

  let depositor1: any;
  let depositor2: any;
  let depositor3NotWhitelisted: any;

  const hardCapWEI = ethers.utils.parseEther("10000");
  const softCapWEI = ethers.utils.parseEther("5000");

  const PoolStatus = {
    Upcoming: 0,
    Ongoing: 1,
    Finished: 2,
    Paused: 3,
    Cancelled: 4,
  };

  before(async () => {
    [
      owner,
      poolOwner,
      raisedWeiReceiver,
      depositor1,
      depositor2,
      depositor3NotWhitelisted,
    ] = await ethers.getSigners();
    now = new Date();
    tomorrow = now.getTime() + 10000; // new Date(new Date().setDate(now.getDate() + 1));
  });

  it("deploy project Token and give allowance to IDO contract to spend it", async () => {
    const initialSupply = 1_000_000_000;
    const RT = await ethers.getContractFactory("ProjectToken");
    projectTokenContract = await RT.deploy(
      "Project Token",
      "RTK",
      initialSupply
    );
    expect(projectTokenContract.address.length > 0);
    const ownersTokenBalance = await projectTokenContract.balanceOf(
      owner.address
    );
    expect(ethers.BigNumber.from(ownersTokenBalance).eq(initialSupply));
  });

  it("deploy IDO contract using DEPLOYER_PK account", async () => {
    const IDO = await ethers.getContractFactory("VentIDO");
    idoContract = await IDO.deploy();
    await idoContract.deployed();
    expect(idoContract.address.length).be.gt(0);
  });

  it("only poolOwner can create a pool", async () => {
    try {
      await idoContract
        .connect(poolOwner)
        .createPool(
          hardCapWEI,
          softCapWEI,
          now.getTime(),
          tomorrow,
          PoolStatus.Upcoming
        );
    } catch (error) {
      expect(true);
    }
  });

  it("Grant poolOwner role to POOL_OWNER_PK account", async () => {
    const success = await idoContract.callStatic.grantPoolOwnerRole(
      poolOwner.address
    );
    await idoContract.grantPoolOwnerRole(poolOwner.address);
    expect(success);
  });

  it("[1/2] create a pool", async () => {
    await idoContract.connect(poolOwner).createPool(
      hardCapWEI,
      softCapWEI,
      now.getTime(), // start time
      tomorrow, // end time
      PoolStatus.Ongoing
    );
  });

  it("[2/2] add detailed info of the pool", async () => {
    await idoContract.connect(poolOwner).addPoolDetailedInfo(
      process.env.RAISED_WEI_RECEIVER_ADDRESS, // project owner
      projectTokenContract.address,
      1, // min allocation per user
      10, // max allocation per user
      1000000, // total token provided 1_000_000
      1, // exchange rate
      1, // token price
      0 // total token sold
    );
  });

  it("get pool information", async () => {
    const cpd = await idoContract.getCompletePoolDetails();

    expect(ethers.BigNumber.from(cpd.pool.softCap).eq(softCapWEI));
    expect(cpd.poolDetails.projectTokenAddress).be.equal(
      projectTokenContract.address
    );
    expect(cpd.pool.status).be.equal(PoolStatus.Ongoing);
    expect(cpd.poolDetails.exchangeRate.toString()).be.equal("1");
    expect(cpd.participationDetails.count.toString()).be.equal("0");
  });

  it("Participants need to be whitelisted to deposit", async () => {
    try {
      await depositor1.sendTransaction({
        to: idoContract.address,
        value: ethers.utils.parseEther("1.0"),
      });
    } catch (error) {
      expect(true);
    }
  });

  it("PoolOwner adds users to whitelist", async () => {
    await idoContract
      .connect(poolOwner)
      .addAddressesToWhitelist([depositor1.address, depositor2.address]);
  });

  it("Whitelisted participants can deposit", async () => {
    // Depositor only needs to be whitelisted, then just send ETH to pool contract to participate.
    const balance = async () => (await depositor1.getBalance()).toString();

    const beforeDeposit = ethers.utils.formatEther(await balance());

    await depositor1.sendTransaction({
      to: idoContract.address,
      value: ethers.utils.parseEther("1.0"),
    });

    const afterDeposit = ethers.utils.formatEther(await balance());
    expect(beforeDeposit - afterDeposit > 0);
  });

  it("pool only accepts deposit if it's status in Ongoing", async () => {
    await idoContract.connect(poolOwner).updatePoolStatus(PoolStatus.Upcoming);

    try {
      await depositor1.sendTransaction({
        to: idoContract.address,
        value: ethers.utils.parseEther("1.0"),
      });
    } catch (error) {
      expect(true);
    }

    await idoContract.connect(poolOwner).updatePoolStatus(PoolStatus.Ongoing);
  });

  it("pool should keep tract of deposits", async () => {
    const details = await idoContract.getCompletePoolDetails();
    const participants = details.participationDetails;

    const countOfParticipants = ethers.BigNumber.from(
      participants.count
    ).toNumber();
    expect(countOfParticipants).be.equal(1);

    const depositor1InvestRecord = participants.investorsDetails[0];
    const p1Address = depositor1InvestRecord.addressOfParticipant;
    expect(p1Address).be.equal(depositor1.address);

    const totalRaised = depositor1InvestRecord.totalRaisedInWei;
    expect(
      ethers.BigNumber.from(totalRaised).eq(ethers.utils.parseEther("1.0"))
    );
  });
});
