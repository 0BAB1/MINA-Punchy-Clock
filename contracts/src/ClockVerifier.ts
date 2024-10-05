import {Poseidon, Field, SmartContract, state, State, method, MerkleTree, Struct, PublicKey, Bool, Hash, MerkleWitness, PrivateKey} from 'o1js';

/**
 * ClockVerifier :
 * Its role is to hold the truth. Public data being store on the server,
 * Modifying it requires the Worker to prove that he did not manipulate
 * his working time without tracking everything he does.
 */
const HEIGHT : number = 10;

export class MerkleWitenessHeight extends MerkleWitness(HEIGHT){}

export class Worker extends Struct({
    workerPublicKey : PublicKey,
    workedHours : Field,
    currentlyWorking : Field,
    lastSeenHash : Field
}){
    punchIn(
    ){
    }
}

export class ClockVerifier extends SmartContract{
    @state(Field) treeRoot = State<Field>();

    init(): void {
        // On deploy, init tree rot to the one of an empty tree
        this.treeRoot.set(
            new MerkleTree(HEIGHT).getRoot()
        );
    }

    @method async addWorker(
        workerPublicKey : PublicKey,
        witness : MerkleWitenessHeight
    ){
        /**
         * When getting hired, the worker does not exist in the tree, to
         * address this problem, the method allows to add a worker @ a leaf
         * ID, with all the associated data, the lastSeenHash will be set to
         * 0 signed by the private key of the worker. To prevent the worker 
         * from bypassing the server sync, this method also asks for a signature
         * of the data by the server.
         */
        
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
        const newRoot = witness.calculateRoot(Poseidon.hash(Worker.toFields(newWorker)))
    }

    @method async punchIn(
    ){
    }
}