pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract NFTKeyDAO_Fhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error InvalidBatchId();
    error InvalidCooldown();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        bool isOpen;
        uint256 totalEncryptedValue;
        uint256 proposalCount;
    }
    mapping(uint256 => Batch) public batches;
    uint256 public currentBatchId;
    uint256 public constant BATCH_NOT_OPEN = type(uint256).max;

    struct EncryptedProposal {
        euint32 encryptedAmount;
        euint32 encryptedTarget;
    }
    mapping(uint256 => mapping(uint256 => EncryptedProposal)) public encryptedProposals; // batchId => proposalId => EncryptedProposal

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId, uint256 totalEncryptedValue, uint256 proposalCount);
    event ProposalSubmitted(address indexed provider, uint256 indexed batchId, uint256 indexed proposalId, bytes32 encryptedAmount, bytes32 encryptedTarget);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalValue);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier respectCooldown(address user) {
        if (block.timestamp < lastSubmissionTime[user] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        currentBatchId = BATCH_NOT_OPEN;
        cooldownSeconds = 60; // Default 1 minute cooldown
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Revert if already unpaused (or use a whenPaused modifier)
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldown(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidCooldown();
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (currentBatchId != BATCH_NOT_OPEN) {
            _closeBatch(currentBatchId); // Close previous batch if one was open
        }
        currentBatchId++;
        batches[currentBatchId] = Batch({isOpen: true, totalEncryptedValue: 0, proposalCount: 0});
        emit BatchOpened(currentBatchId);
    }

    function _closeBatch(uint256 batchId) private {
        if (batchId == BATCH_NOT_OPEN || !batches[batchId].isOpen) revert InvalidBatchId();
        Batch storage batch = batches[batchId];
        batch.isOpen = false;
        emit BatchClosed(batchId, batch.totalEncryptedValue, batch.proposalCount);
    }

    function closeCurrentBatch() external onlyOwner whenNotPaused {
        if (currentBatchId == BATCH_NOT_OPEN) revert BatchNotOpen();
        _closeBatch(currentBatchId);
        currentBatchId = BATCH_NOT_OPEN;
    }

    function submitProposal(
        euint32 encryptedAmount,
        euint32 encryptedTarget
    ) external onlyProvider whenNotPaused respectCooldown(msg.sender) {
        if (currentBatchId == BATCH_NOT_OPEN) revert BatchNotOpen();
        _initIfNeeded(encryptedAmount);
        _initIfNeeded(encryptedTarget);

        Batch storage batch = batches[currentBatchId];
        uint256 proposalId = batch.proposalCount;

        encryptedProposals[currentBatchId][proposalId] = EncryptedProposal({
            encryptedAmount: encryptedAmount,
            encryptedTarget: encryptedTarget
        });

        batch.totalEncryptedValue = FHE.add(batch.totalEncryptedValue, encryptedAmount);
        batch.proposalCount++;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit ProposalSubmitted(
            msg.sender,
            currentBatchId,
            proposalId,
            encryptedAmount.toBytes32(),
            encryptedTarget.toBytes32()
        );
    }

    function requestBatchTotalDecryption(uint256 batchId) external whenNotPaused respectCooldown(msg.sender) {
        if (batchId == BATCH_NOT_OPEN || batches[batchId].isOpen) revert InvalidBatchId(); // Must be a closed batch

        euint32 encryptedTotalValue = FHE.asEuint32(batches[batchId].totalEncryptedValue);
        _initIfNeeded(encryptedTotalValue);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedTotalValue.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // @dev Replay Guard: Ensure this callback is processed only once.
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // @dev State Verification: Rebuild the ciphertexts array from current contract storage
        // in the exact same order as when the decryption was requested.
        // This ensures that the state relevant to the decryption request has not changed.
        DecryptionContext storage ctx = decryptionContexts[requestId];
        uint256 batchId = ctx.batchId;

        euint32 encryptedTotalValue = FHE.asEuint32(batches[batchId].totalEncryptedValue);
        _initIfNeeded(encryptedTotalValue); // Ensure it's initialized for toBytes32

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedTotalValue.toBytes32();
        bytes32 currentHash = _hashCiphertexts(cts);

        if (currentHash != ctx.stateHash) revert StateMismatch();

        // @dev Proof Verification: Verify the proof of correct decryption.
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert DecryptionFailed();

        // Decode and finalize
        uint32 totalValue = abi.decode(cleartexts, (uint32));
        ctx.processed = true;

        emit DecryptionCompleted(requestId, batchId, totalValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 v) internal {
        if (!v.isInitialized()) {
            v.initialize();
        }
    }

    function _initIfNeeded(ebool b) internal {
        if (!b.isInitialized()) {
            b.initialize();
        }
    }

    function _requireInitialized(euint32 v) internal view {
        if (!v.isInitialized()) {
            revert("FHE: euint32 not initialized");
        }
    }

    function _requireInitialized(ebool b) internal view {
        if (!b.isInitialized()) {
            revert("FHE: ebool not initialized");
        }
    }
}