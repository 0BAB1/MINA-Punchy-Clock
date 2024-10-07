import {Provable, Poseidon, Field, SmartContract, state, State, method, MerkleTree, Struct, PublicKey, Bool,  MerkleWitness, Signature} from 'o1js';
import { ORACLE_PUBLIC_KEY } from './GetTime';

/**
 * ClockVerifier : Centralized version
 * 
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
    /**
     * Note that the term "hours" is used for convinience but the
     * time stamps are expressed as milliseconds.
     */
    punchIn(newTime: Field) {
        /**
         * This method only updates the state but does not run the underlying
         * contract logic i.e. verifying the time stamp and the authenticity of
         * the user provided data.
         */

        // Create the condition for whether the worker is currently working
        const isWorking = this.currentlyWorking.equals(Field(1));

        // If the worker was working, update worked hours and set working status to false
        const updatedWorkedHours = Provable.if(
            isWorking,
            this.workedHours.add(newTime.sub(this.lastSeen)),
            this.workedHours // No change if not working
        );

        // Update the working status: flip it (1 becomes 0, 0 becomes 1)
        const updatedWorkingStatus = Provable.if(
            isWorking,
            Field(0), // If currently working, set to not working
            Field(1)  // If not working, set to working
        );

        // Update the fields
        this.workedHours = updatedWorkedHours;
        this.currentlyWorking = updatedWorkingStatus;
        this.lastSeen = newTime;
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
        this.serverPublicKey.set(PublicKey.empty()); // DUMMY KEY
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
        currentServerPublicKey.assertEquals(PublicKey.empty()); // DUMMY KEY
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
        serverSignature : Signature,
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
        // Public input from server DataBase
        workerPublicKey : PublicKey,
        workedHours : Field, // ms
        // Private inputs from the user
        workingStatus : Field,
        lastSeen : Field, //ms
        // Private input time from user, approuved by oracle
        newTime : Field, //ms
        oracleSignature : Signature,
        // Both parties signatures of the newTime stamps
        workerSignature : Signature,
        serverSignature : Signature,
        // Witness for server data to prove authenticity
        witness : MerkleWitenessHeight
    ){
        /**
         * This method verifies that everyone is telling the truth and updates
         * the truth-holding tree, allowing the server to update its states.
         * Note that separating the function argument and re-constructing the Worker
         * Struct in the contract was a choice to put an emphasis on what data is
         * private and what is note simply by looking at the contract, thus avoiding
         * confusion.
         */

        // First of all, check the parties signatures
        const serverPublicKey = this.serverPublicKey.getAndRequireEquals();
        const verifyWorkerSignature = workerSignature.verify(workerPublicKey, [newTime]);
        const verifyServerSignature = serverSignature.verify(serverPublicKey, [newTime]);
        verifyWorkerSignature.assertTrue();
        verifyServerSignature.assertTrue();

        // We then look for the authenticity of the oracle time stamp before going any further
        const verifyOracleSignature = oracleSignature.verify(PublicKey.fromBase58(ORACLE_PUBLIC_KEY), [newTime]);
        verifyOracleSignature.assertTrue();

        // Then, the contract check for the authenticity of the provided public/private data
        const currentRoot = this.treeRoot.getAndRequireEquals();
        const workerState = new Worker({
            workerPublicKey : workerPublicKey,
            workedHours : workedHours,
            currentlyWorking : workingStatus,
            lastSeen : lastSeen
        });
        const witnessRoot = witness.calculateRoot(Poseidon.hash(Worker.toFields(workerState)));
        witnessRoot.assertEquals(currentRoot);

        // If the status is proven to be legit, we can now update the truthy state root
        workerState.punchIn(newTime);
        const newRoot = witness.calculateRoot(Poseidon.hash(Worker.toFields(workerState)));
        this.treeRoot.set(newRoot);
    }
}