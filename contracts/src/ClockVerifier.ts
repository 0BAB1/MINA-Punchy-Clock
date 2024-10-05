import {Poseidon, Field, SmartContract, state, State, method, MerkleTree, Struct, PublicKey, Bool,  MerkleWitness, Signature} from 'o1js';

/**
 * ClockVerifier :
 * Its role is to hold the truth. Public data being store on the server,
 * Modifying it requires the Worker to prove that he did not manipulate
 * his working time without tracking everything he does.
 */
export const HEIGHT : number = 10;

export class MerkleWitenessHeight extends MerkleWitness(HEIGHT){}

export class Worker extends Struct({
    workerPublicKey : PublicKey,
    workedHours : Field,
    currentlyWorking : Field,
    lastSeen : Field
}){
    punchIn(
    ){
    }
}

export class ClockVerifier extends SmartContract{
    @state(Field) treeRoot = State<Field>();
    @state(PublicKey) serverPublicKey = State<PublicKey>();

    init(): void {
        // On deploy, init tree rot to the one of an empty tree
        this.treeRoot.set(
            new MerkleTree(HEIGHT).getRoot()
        );
        // create a dummy server tree to be replaced once and only once
        // on deployement using initServerKey(key) method
        this.serverPublicKey.set(PublicKey.fromFields([Field(0),Field(0)])); // DUMMY KEY
    }

    @method async initServerKey(
        newServerPublicKey : PublicKey
    ){
        /**
         * Sets the initial public ket of the server, shall only be called once,
         * thus the check to revert if someone tried to spoff the server
         */
        const currentServerPublicKey = this.serverPublicKey.getAndRequireEquals();
        // following check to make sure server key wasn't already set/claimed
        currentServerPublicKey.assertEquals(PublicKey.fromFields([Field(0),Field(0)])); // DUMMY KEY
        // set/claim this contract's server key
        this.serverPublicKey.set(newServerPublicKey);
    }

    @method async addWorker(
        workerPublicKey : PublicKey,
        witness : MerkleWitenessHeight, // witness to an associated leaf
        // Signatures, needed to prove both parties agreed 
        // Base58 worker's signature of [Field(0)], todo : replace by a common salt
        workerSignature : Signature,
        // Base58 server's signature of [Field(0)], todo : replace by a common salt  
        serverSignature : Signature     ,
        // salt : Field
    ){
        /**
         * When getting hired, the worker does not exist in the tree, to
         * address this problem, the method allows to add a worker @ a leaf
         * ID, with all the associated data, the lastSeen will be set to
         * 0. To prevent the worker.
         * This method also verifies worker's and server's signatures to
         * avoid any spoofing, cheating or de-sync.
         */

        const serverPublicKey = this.serverPublicKey.getAndRequireEquals();
        // verify the signatures
        const verifyWorkerSignature = workerSignature.verify(workerPublicKey, [Field(0)]);
        const verifyServerSignature = serverSignature.verify(serverPublicKey, [Field(0)]);
        verifyWorkerSignature.assertTrue();
        verifyServerSignature.assertTrue();
        
        // Check if the worker has not been initialized yet (i.e. leaf value is Field(0))
        const currentRoot = this.treeRoot.getAndRequireEquals();
        currentRoot.assertEquals(witness.calculateRoot(Field(0)));

        // Create a new worker instance
        const newWorker = new Worker({
            workerPublicKey : workerPublicKey,
            workedHours : Field(0),
            currentlyWorking : Field(0),
            lastSeen : Field(0)
        });

        // And calculate the new root associated with this new worker instance
        const newRoot = witness.calculateRoot(Poseidon.hash(Worker.toFields(newWorker)));
        this.treeRoot.set(newRoot);
    }

    @method async punchIn(
    ){
    }
}