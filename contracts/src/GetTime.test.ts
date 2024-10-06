import { GetTime } from './GetTime';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Signature,
} from 'o1js';

/**
 * This file tests the GetTime contract.
 * 
 * As stated in the GetTime.ts file, this contract is
 * Only meant to verify that no one tried to cheat on
 * the clock by getting their data from the common trusted
 * API.
 * 
 * Note : ClockVerifier was suppoesed to inherit the GetTime contract's
 * logic bu did not because of an internal bug. This contract is still
 * useful on it's own to verify the logic functionality and discriminate
 * oracle tests, thus making it easier to sport a fault on the oracle side.
 */

interface OracleResponse {
  // The oracle API data structure afer awaiting response.json
  data: {
    time: number
  };
  signature: string;
  publicKey: string;
}

let proofsEnabled = false;

// The public key of our trusted data provider
const ORACLE_PUBLIC_KEY =
  'B62qjrPXot2doFFCpT228TKe6hsfGEUnRmDFoWKFo1ANCHaxtizaWKp';

const ORACLE_API =
  "https://punchoracle.netlify.app/.netlify/functions/api";

describe('GetTime', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: GetTime;

  beforeAll(async () => {
    if (proofsEnabled) await GetTime.compile();
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
    zkApp = new GetTime(zkAppAddress);
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
    const oraclePublicKey = zkApp.oraclePublicKey.get();
    expect(oraclePublicKey).toEqual(PublicKey.fromBase58(ORACLE_PUBLIC_KEY));
  });

  describe('hardcoded values', () => {
    it('', async () => {
      await localDeploy();

      const time = Field(1727967420485);
      const signature = Signature.fromBase58(
        '7mXEQUYNtq9Yn9EqcwLsxXvusvE26RbBMFDkNhCaFoavCtZDjKkoJxKu5nt9AT3bmzZDaQSX9FEcK7FbVkuuTK68ajQKUAEA'
      );

      const txn = await Mina.transaction(senderAccount, async () => {
        await zkApp.verifyOracle(time, signature);
      });
      await txn.prove();
      await txn.sign([senderKey]).send();
    });

    it('throws an error if the signature does not match the time, even by a millisecond', async () => {
      await localDeploy();

      const time = Field(1727967420486);
      const signature = Signature.fromBase58(
        '7mXEQUYNtq9Yn9EqcwLsxXvusvE26RbBMFDkNhCaFoavCtZDjKkoJxKu5nt9AT3bmzZDaQSX9FEcK7FbVkuuTK68ajQKUAEA'
      );

      expect(async () => {
        const txn = await Mina.transaction(senderAccount, async () => {
          await zkApp.verifyOracle(time, signature);
        });
      }).rejects;
    });
  });

  describe("actual API request to the oracle running on netlify", () => {
    it("Emits a response containing a time formated as Date.now() and the signature is valid", async ()=>{
      await localDeploy();

      const response = await fetch(ORACLE_API);
      const data : OracleResponse = await response.json();

      const time = Field(data.data.time);
      const signature = Signature.fromBase58(data.signature);

      const txn = await Mina.transaction(senderAccount, async () => {
        await zkApp.verifyOracle(time, signature);
      });
      await txn.prove();
      await txn.sign([senderKey]).send();
    });
  });
});