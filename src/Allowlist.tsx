// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { Button, Card, Flex } from '@radix-ui/themes';
import { useNetworkVariable } from './networkConfig';
import { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { getObjectExplorerLink } from './utils';

export interface Allowlist {
  id: string;
  name: string;
  list: string[];
}

interface AllowlistProps {
  setRecipientAllowlist: React.Dispatch<React.SetStateAction<string>>;
  setCapId: React.Dispatch<React.SetStateAction<string>>;
}

export function Allowlist({ setRecipientAllowlist, setCapId }: AllowlistProps) {
  const packageId = useNetworkVariable('packageId');
  const suiClient = useSuiClient();
  const currentAccount = useCurrentAccount();
  const [allowlist, setAllowlist] = useState<Allowlist>();
  const { id } = useParams();
  const [capId, setInnerCapId] = useState<string>();

  // Ref for input to avoid querying DOM
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function getAllowlist() {
      if (!currentAccount?.address || !id) return;

      try {
        const res = await suiClient.getOwnedObjects({
          owner: currentAccount.address,
          options: { showContent: true, showType: true },
          filter: { StructType: `${packageId}::allowlist::Cap` },
        });

        const capIdMatch = res.data
            .map((obj) => {
              const fields = (obj!.data!.content as { fields: any }).fields;
              return {
                id: fields?.id.id,
                allowlist_id: fields?.allowlist_id,
              };
            })
            .find((item) => item.allowlist_id === id)?.id;

        if (capIdMatch) {
          setCapId(capIdMatch);
          setInnerCapId(capIdMatch);
        }

        const allowlistObj = await suiClient.getObject({
          id,
          options: { showContent: true },
        });
        const fields = (allowlistObj.data?.content as { fields: any })?.fields || {};
        setAllowlist({
          id,
          name: fields.name,
          list: fields.list || [],
        });
        setRecipientAllowlist(id);
      } catch (err) {
        console.error('Failed to load allowlist:', err);
      }
    }

    getAllowlist();
    const intervalId = setInterval(getAllowlist, 3000);
    return () => clearInterval(intervalId);
  }, [id, currentAccount?.address, packageId]);

  const { mutate: signAndExecute } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) =>
        await suiClient.executeTransactionBlock({
          transactionBlock: bytes,
          signature,
          options: { showRawEffects: true, showEffects: true },
        }),
  });

  const addItem = () => {
    const input = inputRef.current;
    if (!input || !input.value.trim()) return;

    const address = input.value.trim();
    if (!isValidSuiAddress(address)) {
      alert('Invalid Sui address');
      return;
    }

    const tx = new Transaction();
    tx.moveCall({
      arguments: [tx.object(id!), tx.object(capId!), tx.pure.address(address)],
      target: `${packageId}::allowlist::add`,
    });
    tx.setGasBudget(10000000);

    signAndExecute(
        { transaction: tx },
        {
          onSuccess: () => {
            input.value = '';
          },
        },
    );
  };

  const removeItem = (addressToRemove: string) => {
    const tx = new Transaction();
    tx.moveCall({
      arguments: [tx.object(id!), tx.object(capId!), tx.pure.address(addressToRemove)],
      target: `${packageId}::allowlist::remove`,
    });
    tx.setGasBudget(10000000);

    signAndExecute({ transaction: tx });
  };

  // Local styles for this component only
  const localStyles = (
      <style>
        {`
        .allowlist-card {
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 16px;
          padding: 1.75rem;
          color: white;
        }

        .allowlist-title {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
          color: #e0f2fe;
        }

        .allowlist-subtitle {
          font-size: 1rem;
          line-height: 1.6;
          margin-bottom: 1.5rem;
          color: #cbd5e1;
        }

        .allowlist-subtitle a {
          color: #93c5fd;
          text-decoration: underline;
        }

        .add-member-form {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
          align-items: center;
        }

        .add-member-input {
          flex: 1;
          padding: 0.625rem 1rem;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(0, 0, 0, 0.2);
          color: white;
          font-size: 1rem;
        }

        .add-member-input::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }

        .add-member-input:focus {
          outline: none;
          border-color: #818cf8;
          box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.3);
        }

        .allowed-users-title {
          font-size: 1.125rem;
          font-weight: 600;
          margin: 1.25rem 0 0.75rem;
          color: #dbeafe;
        }

        .user-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .user-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.625rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .user-item:last-child {
          border-bottom: none;
        }

        .user-address {
          font-family: monospace;
          font-size: 0.95rem;
          color: #f0f9ff;
          word-break: break-all;
        }

        .empty-message {
          color: #94a3b8;
          font-style: italic;
          margin-top: 0.5rem;
        }
      `}
      </style>
  );

  return (
      <>
        {localStyles}
        <div className="allowlist-card">
          <h2 className="allowlist-title">
            Room: {allowlist?.name || 'Loading...'}
          </h2>

          {allowlist?.id && (
              <p className="allowlist-subtitle">
                Share{' '}
                <a
                    href={`${window.location.origin}/CreateRoom/admin/allowlist/${allowlist.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                  this link
                </a>{' '}
                with Members to grant access to encrypted files in this room.
              </p>
          )}

          <div className="add-member-form">
            <input
                ref={inputRef}
                type="text"
                placeholder="Enter Sui address to add member"
                className="add-member-input"
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
            />
            <Button
                size="3"
                style={{
                  background: 'linear-gradient(to right, #6366f1, #8b5cf6)',
                  color: 'white',
                  border: 'none',
                  fontWeight: 600,
                  minWidth: '80px',
                }}
                onClick={addItem}
            >
              Add
            </Button>
          </div>

          <h3 className="allowed-users-title">Allowed Members</h3>

          {Array.isArray(allowlist?.list) && allowlist.list.length > 0 ? (
              <ul className="user-list">
                {allowlist.list.map((addr, idx) => (
                    <li key={idx} className="user-item">
                      <span className="user-address">{addr}</span>
                      <Button
                          size="2"
                          variant="ghost"
                          color="red"
                          onClick={() => removeItem(addr)}
                          style={{ padding: '4px', minWidth: 'auto' }}
                      >
                        <X size={16} />
                      </Button>
                    </li>
                ))}
              </ul>
          ) : (
              <p className="empty-message">No Member in this allowlist yet.</p>
          )}
        </div>
      </>
  );
}