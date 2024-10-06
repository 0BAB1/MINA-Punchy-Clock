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
  Sign,
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
    serverTree: MerkleTree,
    newWorkerStruct : Worker;
  
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
    newWorkerStruct = new Worker({
      workerPublicKey : PublicKey.fromBase58(hardWorkerKeyPair[1]),
      workedHours : Field(0),
      currentlyWorking : Field(0),
      lastSeen : Field(0)
    });
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
      expect( async () => {
        const additionalTxInit = await Mina.transaction(senderAccount, async () => {
          // we take sender account key as an example for another key
          await zkApp.initServerKey(PublicKey.fromBase58(senderAccount.toBase58())); 
        });
        await additionalTxInit.prove();
        await additionalTxInit.sign([senderKey]).send();
      }).rejects;
      
      // check initial tree sync
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
      // chack if the server key did not change
      expect(zkApp.serverPublicKey.get().toBase58() == hardServerKeyPair[1]).toBe(true);
    // TODO : LOGIC FOR TIMEVERIFIER ADDRESS IS THE SAME, assert good if tests passes
    })
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

    it('Worker can\'t be decalred where another worker already is on this leaf', async () => {
      // Start exactly the same as the previous test...
      await localDeploy();
      const workerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [Field(0)]);
      const serverSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [Field(0)]);
      const verifyWorkerSignature = workerSignature.verify(PublicKey.fromBase58(hardWorkerKeyPair[1]), [Field(0)]);
      expect(verifyWorkerSignature.toString()).toBe("true");
      const uniqueWorkerLeaf = 0n;
      const witness1 = new MerkleWitenessHeight(serverTree.getWitness(uniqueWorkerLeaf));
      const tx1 = await Mina.transaction(senderAccount, async () => {
        await zkApp.addWorker(
          PublicKey.fromBase58(hardWorkerKeyPair[1]),
          witness1,
          workerSignature,
          serverSignature
        );
      });
      await tx1.prove();
      await tx1.sign([senderKey]).send();
      const firstWorker = new Worker({
        workerPublicKey : PublicKey.fromBase58(hardWorkerKeyPair[1]),
        workedHours : Field(0),
        currentlyWorking : Field(0),
        lastSeen : Field(0)
      })
      serverTree.setLeaf(
        uniqueWorkerLeaf,
        Poseidon.hash(
          Worker.toFields(firstWorker)
        )
      );

      /**BUT THEN : we try to re-declare an other worker on the same leaf !
       * Note that it is the server's responsability to keep track of the leaf n°/id
       * associated with a worker, nevertheless, in case a mistake happens, we have
       * to make sure the TX reverts and that the server's state does not get updated
       */

      const witness2 = new MerkleWitenessHeight(serverTree.getWitness(uniqueWorkerLeaf));
      expect( async () => {
        const tx2 = await Mina.transaction(senderAccount, async () => {
          await zkApp.addWorker(
            PublicKey.fromBase58(hardWorkerKeyPair[1]),
            witness2,
            workerSignature,
            serverSignature
          );
        });
        await tx2.prove();
        await tx2.sign([senderKey]).send();
        serverTree.setLeaf(
          uniqueWorkerLeaf,
          Poseidon.hash(
            Worker.toFields(
              new Worker({
                workerPublicKey : PublicKey.fromBase58(senderAccount.toBase58()), // dummy key
                workedHours : Field(0),
                currentlyWorking : Field(0),
                lastSeen : Field(0)
              })
            )
          )
        );
        expect(false).toBe(true); // if the TX goes through, make the test go crazy
      }).rejects;

      // Check if trees still synced
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
      // Check that the root is indeed the first one and was not updated
      expect(witness1.calculateRoot(Poseidon.hash(Worker.toFields(firstWorker))) == zkApp.treeRoot.get());
    });

    it('Worker can\'t be decalred if server signature has been cheated on', async () => {
      await localDeploy();
      // Start exactly the same as the previous test...
      const workerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [Field(0)]);
      // BUT someone tries to signe instead of the server ! aka spoof attack, we use a dummy private key fot that test
      const serverSignature = Signature.create(PrivateKey.fromFields([Field(0), Field(0)]), [Field(0)]);
      const verifyWorkerSignature = workerSignature.verify(PublicKey.fromBase58(hardWorkerKeyPair[1]), [Field(0)]);
      expect(verifyWorkerSignature.toString()).toBe("true");
      const uniqueWorkerLeaf = 0n;
      const witness1 = new MerkleWitenessHeight(serverTree.getWitness(uniqueWorkerLeaf));
      // And we sent the "infected"/"non legit" TX and see how it goes...
      expect( async () => {
        const tx1 = await Mina.transaction(senderAccount, async () => {
          await zkApp.addWorker(
            PublicKey.fromBase58(hardWorkerKeyPair[1]),
            witness1,
            workerSignature,
            serverSignature
          );
        });
        await tx1.prove();
        await tx1.sign([senderKey]).send();
        const firstWorker = new Worker({
          workerPublicKey : PublicKey.fromBase58(hardWorkerKeyPair[1]),
          workedHours : Field(0),
          currentlyWorking : Field(0),
          lastSeen : Field(0)
        })
        serverTree.setLeaf(
          uniqueWorkerLeaf,
          Poseidon.hash(
            Worker.toFields(firstWorker)
          )
        );
        // as the TX is supposed to FAIL, make the test go CRAZY if its does
        expect(false).toBe(true);
      }).rejects;

      // Check if trees still synced
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
      // Check that the root is indeed the one of an EMPTY leaf (empty is by default Filed(0))
      expect(witness1.calculateRoot(Field(0)) == zkApp.treeRoot.get());
      
    });

    it('Worker can\'t be declared if user\'s/worker\'s signature has been cheated on', async () => {
      await localDeploy();
      // in this scenario, someone tries to badge in for ANOTHER person
      // to similate this, we will use a dummy key once agin
      const workerSignature = Signature.create(PrivateKey.fromFields([Field(0), Field(0)]), [Field(0)]);
      // and then everything goes as usual (ie like in the previous tests)
      const serverSignature = Signature.create(PrivateKey.fromFields([Field(0), Field(0)]), [Field(0)]);
      // OOPS ! the server didn't do his job right and the worker signature checked passed anyway !
      const verifyWorkerSignature = workerSignature.verify(PublicKey.fromBase58(hardWorkerKeyPair[1]), [Field(0)]);
      // HERE should go the verification but let's say the server failed at this for any reason...
      const uniqueWorkerLeaf = 0n;
      const witness1 = new MerkleWitenessHeight(serverTree.getWitness(uniqueWorkerLeaf));
      // And we send the "infected"/"non legit" TX and see how it goes...
      expect( async () => {
        const tx1 = await Mina.transaction(senderAccount, async () => {
          await zkApp.addWorker(
            PublicKey.fromBase58(hardWorkerKeyPair[1]),
            witness1,
            workerSignature,
            serverSignature
          );
        });
        await tx1.prove();
        await tx1.sign([senderKey]).send();
        const firstWorker = new Worker({
          workerPublicKey : PublicKey.fromBase58(hardWorkerKeyPair[1]),
          workedHours : Field(0),
          currentlyWorking : Field(0),
          lastSeen : Field(0)
        })
        serverTree.setLeaf(
          uniqueWorkerLeaf,
          Poseidon.hash(
            Worker.toFields(firstWorker)
          )
        );
      }).rejects;

      // Check if trees still synced
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
      // Check that the root is indeed the one of an EMPTY leaf (empty is by default Filed(0))
      expect(witness1.calculateRoot(Field(0)) == zkApp.treeRoot.get());
    });
  });

  describe('Core protocol functionnalities tests + tree root is synced', () => {
    // The public key of our trusted data provider
    const ORACLE_PUBLIC_KEY =
      'B62qjrPXot2doFFCpT228TKe6hsfGEUnRmDFoWKFo1ANCHaxtizaWKp';
    const ORACLE_API =
      "https://punchoracle.netlify.app/.netlify/functions/api";
    const DEFAULT_WORKED_HOURS = Field(0);
    const DEFAULT_WORK_STATUS = Field(0);
    const DEFAULT_PRIVATE_TIMESTAMP = Field(0);
    const DEFAULT_NEW_WORKER_LEAF_ID = 0n;

    async function declareDummyWorker(){
      const workerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [Field(0)]);
      const serverSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [Field(0)]);
      const verifyWorkerSignature = workerSignature.verify(PublicKey.fromBase58(hardWorkerKeyPair[1]), [Field(0)]);
      expect(verifyWorkerSignature.toString()).toBe("true");
      const allocatedWorkerLeaf = DEFAULT_NEW_WORKER_LEAF_ID;
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
      serverTree.setLeaf(
        allocatedWorkerLeaf,
        Poseidon.hash(Worker.toFields(newWorkerStruct))
      );
      // console.log(serverTree.getRoot(), zkApp.treeRoot.get())
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
    }

    async function punchInTX(publicWorkedHours : Field, privateLastSeen : Field, privateStatus : Field, newPrivateTime : Field,
      oracleSignature : Signature, workerSignature : Signature, serverSignature : Signature, serverWitness : MerkleWitenessHeight
    ){
      const punchInTX = await Mina.transaction(senderAccount, async () => {
        await zkApp.punchIn(
          // public data
          PublicKey.fromBase58(hardWorkerKeyPair[1]),
          publicWorkedHours,
          // private data
          privateStatus,
          privateLastSeen,
          // Oracle data
          newPrivateTime,
          oracleSignature,
          // parties signatures
          workerSignature,
          serverSignature,
          // off-chain data witness
          serverWitness
        );
      });
      await punchInTX.prove();
      await punchInTX.sign([senderKey]).send();
    }

    it('Worker can punch-in and status changes', async () => {
      await localDeploy();
      await declareDummyWorker();
      // Check that the worker was indeed declared
      expect(zkApp.treeRoot.get() == new MerkleTree(10).getRoot()).toBe(false);
      expect(checkSync(serverTree, new MerkleTree(10).getRoot())).toBe(false);
      // user queries the ORACLE
      const newPrivateTime = Field(1727967420485);
      const oracleSignature = Signature.fromBase58(
        '7mXEQUYNtq9Yn9EqcwLsxXvusvE26RbBMFDkNhCaFoavCtZDjKkoJxKu5nt9AT3bmzZDaQSX9FEcK7FbVkuuTK68ajQKUAEA'
      );
      const workerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [newPrivateTime]);
      // This data is sent to the server, the server runs some background check before commiting to the
      // contract computation...
      const workerSignatureVerif = workerSignature.verify(PublicKey.fromBase58(hardWorkerKeyPair[1]), [newPrivateTime]);
      const oracleSignatureVerif = oracleSignature.verify(PublicKey.fromBase58(ORACLE_PUBLIC_KEY), [newPrivateTime]);
      expect(workerSignatureVerif.and(oracleSignatureVerif).toString()).toBe("true");
      // the server then approves the TX by signing it and generating a witness of his own data to compare to the on-chain truth
      const serverSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [newPrivateTime]);
      const serverWitness = new MerkleWitenessHeight(serverTree.getWitness(DEFAULT_NEW_WORKER_LEAF_ID));
      // The server then runs the contract, in this test, it shall be successful !
      await punchInTX(
        DEFAULT_WORKED_HOURS,
        DEFAULT_PRIVATE_TIMESTAMP,
        DEFAULT_WORK_STATUS,
        newPrivateTime,
        oracleSignature,
        workerSignature,
        serverSignature,
        serverWitness
      );
      // if the tx was a success, we update the off-chain data base AND the server tree accordingly
      const updateWorker = newWorkerStruct;
      updateWorker.punchIn(newPrivateTime);
      serverTree.setLeaf(
        DEFAULT_NEW_WORKER_LEAF_ID,
        Poseidon.hash(Worker.toFields(updateWorker))
      );
      // run verifications on server/ chain sync
      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true);
    });

    it('Worker can punch-in and twice and all states gets updated', async () => {
      // same start as previous test...
      await localDeploy();
      await declareDummyWorker();
      expect(zkApp.treeRoot.get() == new MerkleTree(10).getRoot()).toBe(false);
      expect(checkSync(serverTree, new MerkleTree(10).getRoot())).toBe(false);
      const firstOrcaleTimeStamp = Field(1727967420485);
      const fistOracleSignature = Signature.fromBase58(
        '7mXEQUYNtq9Yn9EqcwLsxXvusvE26RbBMFDkNhCaFoavCtZDjKkoJxKu5nt9AT3bmzZDaQSX9FEcK7FbVkuuTK68ajQKUAEA'
      );
      const firstWorkerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [firstOrcaleTimeStamp]);
      const firstServerSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [firstOrcaleTimeStamp]);
      const firstServerWitness = new MerkleWitenessHeight(serverTree.getWitness(DEFAULT_NEW_WORKER_LEAF_ID));
      await punchInTX(
        DEFAULT_WORKED_HOURS,
        DEFAULT_PRIVATE_TIMESTAMP,
        DEFAULT_WORK_STATUS,
        firstOrcaleTimeStamp,
        fistOracleSignature,
        firstWorkerSignature,
        firstServerSignature,
        firstServerWitness
      );
      const updateWorker = newWorkerStruct;
      updateWorker.punchIn(firstOrcaleTimeStamp);
      serverTree.setLeaf(
        DEFAULT_NEW_WORKER_LEAF_ID,
        Poseidon.hash(Worker.toFields(updateWorker))
      );

      // send a SECOND TX !
      // first the user requires the server to punch in...
      const secondOracleTimeStamp = Field(1728209845708); // hardcoded values sampled from live oracle api
      const secondOracleSignature = Signature.fromBase58("7mXD6vp5B91ThhLYkfSB8qR5Vexg39op8kwjHLAteHtUs5VKKvgjSkV51nmDbADzQjjmUWMH9jbzJtcgu1FSa3ai8GtUutwL");
      const theoricalNewWorkedTime = secondOracleTimeStamp.sub(firstOrcaleTimeStamp);
      const secondWorkerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [secondOracleTimeStamp]);
      // now to the sever...
      const secondServerSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [secondOracleTimeStamp]);
      const secondServerWitness =  new MerkleWitenessHeight(serverTree.getWitness(DEFAULT_NEW_WORKER_LEAF_ID));
      expect(updateWorker.lastSeen.equals(firstOrcaleTimeStamp).toString()).toBe("true");
      await punchInTX(
        updateWorker.workedHours,
        updateWorker.lastSeen,
        updateWorker.currentlyWorking,
        secondOracleTimeStamp,
        secondOracleSignature,
        secondWorkerSignature,
        secondServerSignature,
        secondServerWitness
      );
      //Verify the TX passed and data has been applied 
      updateWorker.punchIn(secondOracleTimeStamp);
      expect(updateWorker.workedHours.equals(theoricalNewWorkedTime).toString()).toBe("true");
      expect(updateWorker.currentlyWorking.equals(Field(0)).toString()).toBe("true");
      expect(updateWorker.lastSeen.equals(secondOracleTimeStamp).toString()).toBe("true");
      expect(updateWorker.workerPublicKey.toBase58() == hardWorkerKeyPair[1]).toBe(true);

      serverTree.setLeaf(
        DEFAULT_NEW_WORKER_LEAF_ID,
        Poseidon.hash(Worker.toFields(updateWorker))
      );

      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true); // chain and server synced
      // AND chain data include new worker data

      expect(
        new MerkleWitenessHeight(serverTree.getWitness(DEFAULT_NEW_WORKER_LEAF_ID)).calculateRoot(
          Poseidon.hash(Worker.toFields(updateWorker))
        ).equals(zkApp.treeRoot.get()).toString()
      ).toBe("true");

      // and then a THIRD TX to verify the provable ifs behavior completely
      const thirdOracleTimeStamp = Field(1728225355876); // hardcoded values sampled from live oracle api
      const thirdOracleSignature = Signature.fromBase58("7mXS2PQxvu1vitbn2UVfCxSkZjmx642JsSgHM6SKhui7QRoBaawY6LV3n984WNUnN7QzpoJjuS3MTqCmSHCFy1ZXDwveNvNw");
      // theorical new time does NOT change !
      const thirdWorkerSignature = Signature.create(PrivateKey.fromBase58(hardWorkerKeyPair[0]), [thirdOracleTimeStamp]);
      // now to the sever...
      const thirdServerSignature = Signature.create(PrivateKey.fromBase58(hardServerKeyPair[0]), [thirdOracleTimeStamp]);
      const thirdServerWitness =  new MerkleWitenessHeight(serverTree.getWitness(DEFAULT_NEW_WORKER_LEAF_ID));
      expect(updateWorker.lastSeen.equals(secondOracleTimeStamp).toString()).toBe("true");
      await punchInTX(
        updateWorker.workedHours,
        updateWorker.lastSeen,
        updateWorker.currentlyWorking,
        thirdOracleTimeStamp,
        thirdOracleSignature,
        thirdWorkerSignature,
        thirdServerSignature,
        thirdServerWitness
      );
      //Verify the TX passed and data has been applied 
      updateWorker.punchIn(thirdOracleTimeStamp);
      expect(updateWorker.workedHours.equals(theoricalNewWorkedTime).toString()).toBe("true");
      expect(updateWorker.currentlyWorking.equals(Field(1)).toString()).toBe("true");
      expect(updateWorker.lastSeen.equals(thirdOracleTimeStamp).toString()).toBe("true");
      expect(updateWorker.workerPublicKey.toBase58() == hardWorkerKeyPair[1]).toBe(true);

      serverTree.setLeaf(
        DEFAULT_NEW_WORKER_LEAF_ID,
        Poseidon.hash(Worker.toFields(updateWorker))
      );

      expect(checkSync(serverTree, zkApp.treeRoot.get())).toBe(true); // chain and server synced
      // AND chain data include new worker data

      expect(
        new MerkleWitenessHeight(serverTree.getWitness(DEFAULT_NEW_WORKER_LEAF_ID)).calculateRoot(
          Poseidon.hash(Worker.toFields(updateWorker))
        ).equals(zkApp.treeRoot.get()).toString()
      ).toBe("true");
    });
    it.todo('Worker can punch-in using actual LIVE ORACLE api calls');
    it.todo('Worker can punch-in twice actual LIVE ORACLE api calls');
  });

  describe("Worker cheat preventing", () => {
    it.todo('Worker cannot cheat on the previous time');
    it.todo('Worker cannot cheat on the worked hours');
    // The following has already test in the GetTime test suite but re-tested for good measure
    it.todo('Worker cannot cheat on the new time stamp');
    // The following has already test in the GetTime test suite but re-tested for good measure
    it.todo('Worker cannot spoof the oracle');
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

  describe("Actual server tests", () => {
    it.todo('Worker cannot cheat for creation and no computation does of Worker cheats on his signature');
    it.todo('Worker cannot cheat for update and no computation does of Worker cheats on his signature');
    it.todo('TX does not go through if the server tries tempering with incomming worker data in case of server being taken over.');
    it.todo('TX does not go through if someone tries to spoof the server.');
    it.todo('server held public statesare NOT updated if a TX does not goes though');
    it.todo('Worker can\'t be decalred if worker\'s public key is already in the public data, no matter the leaf'); // requires an implemented DB
  });
});
