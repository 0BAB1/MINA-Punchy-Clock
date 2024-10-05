import { ClockVerifier } from './ClockVerifier';

import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  MerkleTree,
  Signature,
} from 'o1js';

/**
 * DESCRIPTION
 * 
 * This file tests ClockVerifier Contract functionalities
 * The worker gets and verifies his time stamp using the oracle and
 * the GetTime contract for verification.
 */

function checkSync(
  /**
   * Checks sync between the app and the server, called after
   * each test, HAS to be TRUE
   */
  serverTreeRoot : Field,
  zkAppTreeRoot : Field
) : boolean {
  return true;
}

let proofsEnabled = false;

describe('ClockVerifier', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: ClockVerifier;

  beforeAll(async () => {
    if (proofsEnabled) await ClockVerifier.compile();
  });

  beforeEach(async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    deployerAccount = Local.testAccounts[0];
    deployerKey = deployerAccount.key;
    senderAccount = Local.testAccounts[1];
    senderKey = senderAccount.key;
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new ClockVerifier(zkAppAddress);
  });

  afterEach(async () =>{
    // The sync between server data and contract truth needs
    // to be true after every test
    expect(checkSync).toHaveBeenCalled();
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkApp.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('generates and deploys the `GetTime` smart contract', async () => {
    await localDeploy();
  });

  describe('Worker declaration', () => {
    it.todo('Worker can be declared');
    it.todo('Worker can\'t be decalred where another worker already is');
  });

  describe('Core protocol functionnalities tests + tree root is synced', () => {
    it.todo('Worker can punch-in and status changes');
    it.todo('Worker can punch-in and twice and workedHours get updated');
    it.todo('Worker can punch-in and tree times and workedHours get updated and status changes');
  });

  describe("Worker cheat preventing", () => {
    it.todo('Worker cannot cheat on the previous time');
    it.todo('Worker cannot cheat on the worked hours');
    it.todo('Worker cannot cheat on the new time');
    it.todo('Worker cannot cheat on his status');
    it.todo('Worker cannot sign for another');
  });

  describe("Privacy", () => {
    it.todo('Worker lastSeen data remains private');
    it.todo('Worker cannot sign for another');
  });

  describe("Server approval, avoid breaking the app sync", () => {
    it.todo('The TX does not go through if the server did not approve the TX');
    it.todo('The TX does not go through if the server was spoofed');
  });
});
