import { sign, signFieldElement } from 'o1js/dist/node/mina-signer/src/signature';
import { ClockVerifier, HEIGHT, MerkleWitenessHeight, Worker } from './ClockVerifier';

import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  MerkleTree,
  Poseidon,
  Signature,
  assert
} from 'o1js';

/**
 * DESCRIPTION
 * 
 * This file tests ClockVerifier Contract functionalities
 * The worker gets and verifies his time stamp using the oracle and
 * the GetTime contract for verification.
 */

function checkSync(
  serverTree : MerkleTree,
  zkAppTreeRoot : Field
) : boolean {
  /**
   * Checks sync between the app and the server, called after
   * each test is mandatory.
   */
  const serverRoot = serverTree.getRoot();
  return serverRoot.toString() === zkAppTreeRoot.toString();
}

let proofsEnabled = false;

describe('ClockVerifier', () => {
  let deployerAccount: Mina.TestPublicKey,
    deployerKey: PrivateKey,
    senderAccount: Mina.TestPublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: ClockVerifier,
    serverTree: MerkleTree;
  
  // Hardcoded key pairs for simulating parties signatures for TX approvals
  const hardServerKeyPair = [ // @0 : PRIVATE / @1 : PUBLIC
    "EKEwKX8P8qnuzWGCbsndYSKwqxVDBe6X1AfPauH7Ar2eWaDs8QLG",
    "B62qoiK2XKmQkWgyJrQ5dBnGAEkbG2sQ178To7zg41ye4TLgydKUiJN"
  ];
  const hardWorkerKeyPair = [ // @0 : PRIVATE / @1 : PUBLIC
    "EKF5gV1tZKwYcmrrX71ostFjM36kNwZ7CQhbCNDbQeU6fNYYtib6",
    "B62qnnMDkAXy6WQ5FoVVTehvgoPnJek8BfPgiXV5BjGsFDmKaW7mUyb"
  ];
  const networkId = 'testnet';

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
    serverTree = new MerkleTree(HEIGHT);
  });

  async function localDeploy() {
    const deployTxn = await Mina.transaction(deployerAccount, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkApp.deploy();
    });
    await deployTxn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await deployTxn.sign([deployerKey, zkAppPrivateKey]).send();

    const txInit = await Mina.transaction(senderAccount, async () => {
      await zkApp.initServerKey(PublicKey.fromBase58(hardServerKeyPair[1]));
    });
    await txInit.prove();
    await txInit.sign([senderKey]).send();
  }

  describe('Correct contract initialiation', () => {
    it('generates and deploys the `ClockVerifier` smart contract', async () => {
      await localDeploy();
      // check initial  tree sync
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
      // chack if the server key were corrctly initialized
      expect(zkApp.serverPublicKey.get().toBase58() == hardServerKeyPair[1]).toBe(true);
    });

    it("does not accept a re-init of the contract state : serverKey", async () => {
      await localDeploy();
      // try to re-init the key (someone trying to spoof for example)
      try{
        const additionalTxInit = await Mina.transaction(senderAccount, async () => {
          // we take sender account key as an example for another key
          await zkApp.initServerKey(PublicKey.fromBase58(senderAccount.toBase58())); 
        });
        await additionalTxInit.prove();
        await additionalTxInit.sign([senderKey]).send();
      }catch{
        
      }
      // check initial tree sync
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
      // chack if the server key did not change
      expect(zkApp.serverPublicKey.get().toBase58() == hardServerKeyPair[1]).toBe(true);
    });
  });

  describe('Worker declaration checks, hardcoded keys and server interactions', () => {
    it('Worker can be declared', async () => {
      await localDeploy();
      // User/worker queries for an account creation
      const workerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [Field(0)]);

      // Sends it to server.. server gets the resquest and signs too
      const serverSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [Field(0)]);
      // The server also verifies that the user's signature is indeed right before commiting to the computation
      const verifyWorkerSignature = workerSignature.verify(PublicKey.fromBase58(hardWorkerKeyPair[1]), [Field(0)]);
      expect(verifyWorkerSignature.toString()).toBe("true");
      // the server then runs the computation
      const allocatedWorkerLeaf = 0n;
      const witness = new MerkleWitenessHeight(serverTree.getWitness(allocatedWorkerLeaf));
      const tx = await Mina.transaction(senderAccount, async () => {
        await zkApp.addWorker(
          PublicKey.fromBase58(hardWorkerKeyPair[1]),
          witness,
          workerSignature,
          serverSignature
        );
      });
      await tx.prove();
      await tx.sign([senderKey]).send();
      // if the transaction was a success, update the server tree
      serverTree.setLeaf(
        allocatedWorkerLeaf,
        Poseidon.hash(
          Worker.toFields(
            new Worker({
              workerPublicKey : PublicKey.fromBase58(hardWorkerKeyPair[1]),
              workedHours : Field(0),
              currentlyWorking : Field(0),
              lastSeen : Field(0)
            })
          )
        )
      );
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
    });
    it.todo('Worker can\'t be decalred where another worker already is on this leaf');
    it.todo('Worker can\'t be decalred if worker\'s public key is already in the public data, no matter the leaf');
    it.todo('Worker can\'t be decalred if server signature has been cheated on');
    it.todo('Worker can\'t be decalred if user\'s/worker\'s signature has been cheated on');
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

  describe("Server data sync checks using server API endpoint", () => {
    it.todo('The initialization (hiring) of a newworker does init a default entry in the server DB');
    it.todo('A TX does update the worker\'s status on the server DB');
    it.todo('A faulty/reversed TX does NOT update the worker\'s status on the server DB');
  });

  describe("Actual server logic check", () => {
    it.todo('Worker cannot cheat for creation and no computation does of Worker cheats on his signature');
    it.todo('Worker cannot cheat for update and no computation does of Worker cheats on his signature');
  });

  describe("Server was altered or spoofing attacks checks", () => {
    it.todo('TX does not go through if the server tries tempering with incomming worker data in case of server being taken over.');
    it.todo('TX does not go through if someone tries to spoof the server.');
  });
});
