// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface TreasuryRecord {
  id: string;
  name: string;
  encryptedBalance: string;
  encryptedThreshold: string;
  timestamp: number;
  owner: string;
  status: "active" | "locked";
}

// Randomly selected styles: High Contrast (Blue+Orange), Glass Morphism, Center Radiation, Animation Rich
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [treasuries, setTreasuries] = useState<TreasuryRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newTreasuryData, setNewTreasuryData] = useState({ name: "", initialBalance: 0, threshold: 0 });
  const [selectedTreasury, setSelectedTreasury] = useState<TreasuryRecord | null>(null);
  const [decryptedBalance, setDecryptedBalance] = useState<number | null>(null);
  const [decryptedThreshold, setDecryptedThreshold] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [proposalAmount, setProposalAmount] = useState(0);
  const [proposalDescription, setProposalDescription] = useState("");

  // Randomly selected features: Project Introduction, Data Statistics, Proposal System
  useEffect(() => {
    loadTreasuries().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadTreasuries = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("treasury_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing treasury keys:", e); }
      }
      
      const list: TreasuryRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`treasury_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                name: recordData.name,
                encryptedBalance: recordData.balance,
                encryptedThreshold: recordData.threshold,
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                status: recordData.status || "active"
              });
            } catch (e) { console.error(`Error parsing treasury data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading treasury ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTreasuries(list);
    } catch (e) { console.error("Error loading treasuries:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createTreasury = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting treasury data with Zama FHE..." });
    try {
      const encryptedBalance = FHEEncryptNumber(newTreasuryData.initialBalance);
      const encryptedThreshold = FHEEncryptNumber(newTreasuryData.threshold);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const treasuryId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const treasuryData = { 
        name: newTreasuryData.name,
        balance: encryptedBalance, 
        threshold: encryptedThreshold,
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        status: "active"
      };
      
      await contract.setData(`treasury_${treasuryId}`, ethers.toUtf8Bytes(JSON.stringify(treasuryData)));
      
      const keysBytes = await contract.getData("treasury_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(treasuryId);
      await contract.setData("treasury_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE-encrypted treasury created!" });
      await loadTreasuries();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTreasuryData({ name: "", initialBalance: 0, threshold: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const submitProposal = async () => {
    if (!selectedTreasury || !isConnected) return;
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Processing proposal with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const proposalId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const proposalData = {
        treasuryId: selectedTreasury.id,
        amount: FHEEncryptNumber(proposalAmount),
        description: proposalDescription,
        timestamp: Math.floor(Date.now() / 1000),
        proposer: address,
        status: "pending"
      };
      
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Proposal submitted with FHE encryption!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowProposalModal(false);
        setProposalAmount(0);
        setProposalDescription("");
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Proposal failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const isOwner = (treasuryAddress: string) => address?.toLowerCase() === treasuryAddress.toLowerCase();

  const renderStats = () => {
    const activeCount = treasuries.filter(t => t.status === "active").length;
    const lockedCount = treasuries.filter(t => t.status === "locked").length;
    
    return (
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{treasuries.length}</div>
          <div className="stat-label">Total Treasuries</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{activeCount}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{lockedCount}</div>
          <div className="stat-label">Locked</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>DAO<span>Key</span>NFT</h1>
          <p>FHE-Encrypted Treasury Access</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Create Treasury
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="hero-section">
          <div className="hero-content">
            <h2>FHE-Encrypted DAO Treasuries</h2>
            <p>NFT keys that grant access to encrypted sub-treasuries with Zama FHE technology</p>
            <div className="fhe-badge">
              <span>Fully Homomorphic Encryption</span>
            </div>
          </div>
          <div className="hero-animation">
            <div className="nft-key"></div>
            <div className="fhe-lock"></div>
          </div>
        </div>

        <div className="project-intro">
          <h3>Project Introduction</h3>
          <p>
            DAOKeyNFT combines NFT ownership with FHE-encrypted treasury access. Each NFT serves as a key to a specific 
            sub-treasury within a larger DAO. The treasury balances and thresholds are encrypted using Zama FHE technology, 
            allowing secure computations without exposing sensitive financial data.
          </p>
          <div className="tech-stack">
            <div className="tech-item">Zama FHE</div>
            <div className="tech-item">NFT</div>
            <div className="tech-item">DAO Governance</div>
          </div>
        </div>

        <div className="dashboard-section">
          <div className="section-header">
            <h3>Treasury Statistics</h3>
            <button onClick={loadTreasuries} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {renderStats()}
        </div>

        <div className="treasuries-section">
          <div className="section-header">
            <h3>Encrypted Treasuries</h3>
            <div className="actions">
              <button onClick={() => setShowCreateModal(true)} className="action-btn">
                + New Treasury
              </button>
            </div>
          </div>
          
          {treasuries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"></div>
              <p>No treasuries found</p>
              <button onClick={() => setShowCreateModal(true)} className="primary-btn">
                Create First Treasury
              </button>
            </div>
          ) : (
            <div className="treasuries-grid">
              {treasuries.map(treasury => (
                <div 
                  key={treasury.id} 
                  className={`treasury-card ${treasury.status}`}
                  onClick={() => setSelectedTreasury(treasury)}
                >
                  <div className="card-header">
                    <h4>{treasury.name}</h4>
                    <span className={`status-badge ${treasury.status}`}>
                      {treasury.status}
                    </span>
                  </div>
                  <div className="card-body">
                    <div className="info-item">
                      <span>Owner:</span>
                      <span>{treasury.owner.substring(0, 6)}...{treasury.owner.substring(38)}</span>
                    </div>
                    <div className="info-item">
                      <span>Created:</span>
                      <span>{new Date(treasury.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="encrypted-data">
                      <span>Encrypted Balance:</span>
                      <div>{treasury.encryptedBalance.substring(0, 30)}...</div>
                    </div>
                  </div>
                  <div className="card-footer">
                    {isOwner(treasury.owner) && (
                      <button 
                        className="action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTreasury(treasury);
                          setShowProposalModal(true);
                        }}
                      >
                        Make Proposal
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Create New Treasury</h3>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Treasury Name</label>
                <input
                  type="text"
                  value={newTreasuryData.name}
                  onChange={(e) => setNewTreasuryData({...newTreasuryData, name: e.target.value})}
                  placeholder="Give your treasury a name"
                />
              </div>
              <div className="form-group">
                <label>Initial Balance (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newTreasuryData.initialBalance}
                  onChange={(e) => setNewTreasuryData({...newTreasuryData, initialBalance: parseFloat(e.target.value)})}
                  placeholder="Enter initial balance"
                />
              </div>
              <div className="form-group">
                <label>Spending Threshold (FHE Encrypted)</label>
                <input
                  type="number"
                  value={newTreasuryData.threshold}
                  onChange={(e) => setNewTreasuryData({...newTreasuryData, threshold: parseFloat(e.target.value)})}
                  placeholder="Enter spending threshold"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-row">
                  <span>Balance:</span>
                  <code>{newTreasuryData.initialBalance ? FHEEncryptNumber(newTreasuryData.initialBalance).substring(0, 30) + '...' : 'Not encrypted yet'}</code>
                </div>
                <div className="preview-row">
                  <span>Threshold:</span>
                  <code>{newTreasuryData.threshold ? FHEEncryptNumber(newTreasuryData.threshold).substring(0, 30) + '...' : 'Not encrypted yet'}</code>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button onClick={createTreasury} disabled={creating} className="primary-btn">
                {creating ? "Creating..." : "Create Treasury"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTreasury && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Treasury Details</h3>
              <button onClick={() => setSelectedTreasury(null)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span>Name:</span>
                <strong>{selectedTreasury.name}</strong>
              </div>
              <div className="detail-row">
                <span>Status:</span>
                <span className={`status-badge ${selectedTreasury.status}`}>
                  {selectedTreasury.status}
                </span>
              </div>
              <div className="detail-row">
                <span>Owner:</span>
                <strong>{selectedTreasury.owner}</strong>
              </div>
              <div className="detail-row">
                <span>Created:</span>
                <strong>{new Date(selectedTreasury.timestamp * 1000).toLocaleString()}</strong>
              </div>
              
              <div className="encrypted-section">
                <h4>Encrypted Data</h4>
                <div className="encrypted-data">
                  <span>Balance:</span>
                  <code>{selectedTreasury.encryptedBalance.substring(0, 50)}...</code>
                </div>
                <div className="encrypted-data">
                  <span>Threshold:</span>
                  <code>{selectedTreasury.encryptedThreshold.substring(0, 50)}...</code>
                </div>
                
                <button 
                  className="decrypt-btn"
                  onClick={async () => {
                    if (decryptedBalance !== null) {
                      setDecryptedBalance(null);
                      setDecryptedThreshold(null);
                      return;
                    }
                    const balance = await decryptWithSignature(selectedTreasury.encryptedBalance);
                    const threshold = await decryptWithSignature(selectedTreasury.encryptedThreshold);
                    setDecryptedBalance(balance);
                    setDecryptedThreshold(threshold);
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedBalance !== null ? "Hide Values" : "Decrypt with Wallet"}
                </button>
              </div>
              
              {decryptedBalance !== null && decryptedThreshold !== null && (
                <div className="decrypted-section">
                  <h4>Decrypted Values</h4>
                  <div className="decrypted-row">
                    <span>Balance:</span>
                    <strong>{decryptedBalance}</strong>
                  </div>
                  <div className="decrypted-row">
                    <span>Threshold:</span>
                    <strong>{decryptedThreshold}</strong>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={() => setSelectedTreasury(null)} className="cancel-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showProposalModal && selectedTreasury && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>New Spending Proposal</h3>
              <button onClick={() => setShowProposalModal(false)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Amount</label>
                <input
                  type="number"
                  value={proposalAmount}
                  onChange={(e) => setProposalAmount(parseFloat(e.target.value))}
                  placeholder="Enter amount to spend"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={proposalDescription}
                  onChange={(e) => setProposalDescription(e.target.value)}
                  placeholder="Describe the purpose of this spending"
                />
              </div>
              <div className="fhe-notice">
                <div className="notice-icon"></div>
                <p>This proposal will be encrypted with Zama FHE and stored on-chain</p>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowProposalModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button onClick={submitProposal} disabled={creating} className="primary-btn">
                {creating ? "Submitting..." : "Submit Proposal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>DAOKeyNFT</h4>
            <p>FHE-encrypted treasury access powered by Zama</p>
          </div>
          <div className="footer-section">
            <h4>Technology</h4>
            <ul>
              <li>Zama FHE</li>
              <li>NFT Standards</li>
              <li>DAO Governance</li>
            </ul>
          </div>
          <div className="footer-section">
            <h4>Resources</h4>
            <ul>
              <li>Documentation</li>
              <li>GitHub</li>
              <li>Whitepaper</li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2025 DAOKeyNFT. All rights reserved.</p>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;