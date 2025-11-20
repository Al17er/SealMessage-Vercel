// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, useRef, useMemo } from 'react';
import { useSignPersonalMessage, useSuiClient } from '@mysten/dapp-kit';
import { useNetworkVariable } from './networkConfig';
import { Button, Card, Flex, Text, TextField } from '@radix-ui/themes';
import { fromHex } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';
import {
  SealClient,
  SessionKey,
  type ExportedSessionKey,
} from '@mysten/seal';
import { downloadAndDecrypt, getObjectExplorerLink, MoveCallConstructor } from './utils';
import { set, get } from 'idb-keyval';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';

const TTL_MIN = 5;
const POLLING_INTERVAL_MS = 10000; // 10 seconds

export interface FeedData {
  allowlistId: string;
  allowlistName: string;
  blobIds: string[];
}

export interface DecryptedFile {
  url: string;
  mimeType: string;
  textContent?: string;
  timestamp?: Date;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (s) => map[s]);
}

function constructMoveCall(packageId: string, allowlistId: string): MoveCallConstructor {
  return (tx: Transaction, id: string) => {
    tx.moveCall({
      target: `${packageId}::allowlist::seal_approve`,
      arguments: [tx.pure.vector('u8', fromHex(id)), tx.object(allowlistId)],
    });
  };
}

interface ChatState {
  feed: FeedData | null;
  decryptedFiles: DecryptedFile[];
  error: string | null;
  isDecrypting: boolean;
}

const Feeds: React.FC<{ suiAddress: string }> = ({ suiAddress }) => {
  const suiClient = useSuiClient();
  const serverObjectIds = [
    "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"
  ];

  const client = useMemo(
      () =>
          new SealClient({
            suiClient,
            serverConfigs: serverObjectIds.map((id) => ({
              objectId: id,
              weight: 1,
            })),
            verifyKeyServers: false,
          }),
      [suiClient]
  );

  const packageId = useNetworkVariable('packageId');

  const [roomId, setRoomId] = useState<string>('');
  const [chatState, setChatState] = useState<ChatState>({
    feed: null,
    decryptedFiles: [],
    error: null,
    isDecrypting: false,
  });

  const intervalRef = useRef<number | null>(null);
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const { mutate: signPersonalMessage } = useSignPersonalMessage();

  const fetchFeedById = async (id: string): Promise<FeedData | null> => {
    if (!id.startsWith('0x')) return null;
    try {
      const allowlist = await suiClient.getObject({
        id,
        options: { showContent: true },
      });

      if (
          !allowlist.data?.content ||
          allowlist.data.content.dataType !== 'moveObject'
      ) {
        return null;
      }

      const encryptedObjects = await suiClient
          .getDynamicFields({ parentId: id })
          .then((res) => res.data.map((obj) => obj.name.value as string));

      const content = allowlist.data.content;
      let name = 'Unnamed';
      if ('fields' in content) {
        const fields = content.fields as Record<string, any>;
        if (typeof fields.name === 'string') {
          name = fields.name;
        }
      }

      return {
        allowlistId: id,
        allowlistName: name,
        blobIds: encryptedObjects,
      };
    } catch (err) {
      console.error(`Failed to fetch allowlist ${id}:`, err);
      return null;
    }
  };

  const decryptChat = async (chatId: string, isAutoPolling = false) => {
    if (isAutoPolling) {
      setChatState((prev) => ({ ...prev, isDecrypting: true }));
    }

    const feed = await fetchFeedById(chatId);
    if (!feed || feed.blobIds.length === 0) {
      setChatState({
        feed: null,
        decryptedFiles: [],
        error: feed ? null : 'Invalid or empty allowlist ID',
        isDecrypting: false,
      });
      return;
    }

    if (!isAutoPolling) {
      setChatState((prev) => ({ ...prev, feed, isDecrypting: true, error: null, decryptedFiles: [] }));
    }

    const cacheKey = `sessionKey_${packageId}_${suiAddress}`;
    let sessionKeyToUse: SessionKey | null = null;

    const imported: ExportedSessionKey = await get(cacheKey);
    if (imported) {
      try {
        const currentSessionKey = await SessionKey.import(
            imported,
            new SuiClient({ url: getFullnodeUrl('testnet') })
        );
        if (
            currentSessionKey &&
            !currentSessionKey.isExpired() &&
            currentSessionKey.getAddress() === suiAddress
        ) {
          sessionKeyToUse = currentSessionKey;
        } else {
          await set(cacheKey, null);
        }
      } catch (error) {
        console.log('Imported session key is expired or invalid', error);
        await set(cacheKey, null);
      }
    }

    if (!sessionKeyToUse) {
      if (isAutoPolling) {
        setChatState((prev) => ({ ...prev, isDecrypting: false }));
        return;
      }
      try {
        const newSessionKey = await SessionKey.create({
          address: suiAddress,
          packageId,
          ttlMin: TTL_MIN,
          suiClient,
        });

        const result = await new Promise<{ signature: string }>((resolve, reject) => {
          signPersonalMessage(
              { message: newSessionKey.getPersonalMessage() },
              {
                onSuccess: resolve,
                onError: reject,
              }
          );
        });

        await newSessionKey.setPersonalMessageSignature(result.signature);
        sessionKeyToUse = newSessionKey;
        await set(cacheKey, sessionKeyToUse.export());
      } catch (err: any) {
        setChatState((prev) => ({
          ...prev,
          isDecrypting: false,
          error: err.message || 'Failed to sign message for decryption.',
        }));
        return;
      }
    }

    if (!sessionKeyToUse) return;

    try {
      const moveCallConstructor = constructMoveCall(packageId, chatId);
      await new Promise<void>((resolve, reject) => {
        downloadAndDecrypt(
            feed.blobIds,
            sessionKeyToUse!,
            suiClient,
            client,
            moveCallConstructor,
            async (errMsg) => {
              await set(cacheKey, null);
              console.error('Decryption error:', errMsg);
              setChatState((prev) => ({ ...prev, error: errMsg, isDecrypting: false }));
              reject(errMsg);
            },
            (files) => {
              const filesWithMeta = files.map((file) => ({
                ...file,
                mimeType: 'text/plain',
                textContent: undefined,
                timestamp: undefined,
              }));

              const updatedFiles: DecryptedFile[] = [...filesWithMeta];
              let completedCount = 0;

              blobUrlsRef.current.forEach(URL.revokeObjectURL);
              blobUrlsRef.current.clear();

              filesWithMeta.forEach((file, index) => {
                if (file.url.startsWith('blob:')) {
                  blobUrlsRef.current.add(file.url);
                }

                fetch(file.url)
                    .then((res) => res.arrayBuffer())
                    .then((buffer) => {
                      const uint8Array = new Uint8Array(buffer);
                      const decoder = new TextDecoder('utf-8');
                      const text = decoder.decode(uint8Array);

                      const timestampMatch = text.match(/^\[([^\]]+)\]/);
                      let timestamp: Date | undefined;
                      if (timestampMatch) {
                        const dateStr = timestampMatch[1];
                        const parsed = new Date(dateStr);
                        if (!isNaN(parsed.getTime())) {
                          timestamp = parsed;
                        }
                      }

                      updatedFiles[index] = {
                        ...updatedFiles[index],
                        textContent: text,
                        timestamp,
                      };

                      completedCount++;
                      if (completedCount === filesWithMeta.length) {
                        const sortedFiles = [...updatedFiles].sort((a, b) => {
                          if (!a.timestamp && !b.timestamp) return 0;
                          if (!a.timestamp) return 1;
                          if (!b.timestamp) return -1;
                          return a.timestamp.getTime() - b.timestamp.getTime();
                        });

                        setChatState((prev) => ({
                          ...prev,
                          decryptedFiles: sortedFiles,
                        }));
                      }
                    })
                    .catch(() => {
                      updatedFiles[index] = {
                        ...updatedFiles[index],
                        textContent: '[Failed to load content]',
                        timestamp: undefined,
                      };

                      completedCount++;
                      if (completedCount === filesWithMeta.length) {
                        const sortedFiles = [...updatedFiles].sort((a, b) => {
                          if (!a.timestamp && !b.timestamp) return 0;
                          if (!a.timestamp) return 1;
                          if (!b.timestamp) return -1;
                          return a.timestamp.getTime() - b.timestamp.getTime();
                        });
                        setChatState((prev) => ({
                          ...prev,
                          decryptedFiles: sortedFiles,
                        }));
                      }
                    });
              });

              resolve();
            },
            () => {}, // ✅ onStart: no-op function instead of undefined
            () => {}  // ✅ onSuccess: no-op function instead of undefined
        );
      });
    } catch (err) {
      console.error('Decryption failed:', err);
      await set(cacheKey, null);
    } finally {
      setChatState((prev) => ({ ...prev, isDecrypting: false }));
    }
  };

  const startPolling = (chatId: string) => {
    stopPolling();
    intervalRef.current = window.setInterval(() => {
      decryptChat(chatId, true);
    }, POLLING_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleDecrypt = () => {
    decryptChat(roomId, false);
    if (roomId) {
      startPolling(roomId);
    }
  };

  useEffect(() => {
    if (roomId && roomId.startsWith('0x')) {
      decryptChat(roomId, true);
      startPolling(roomId);
    } else {
      stopPolling();
      setChatState({
        feed: null,
        decryptedFiles: [],
        error: null,
        isDecrypting: false,
      });
    }
  }, [roomId, suiAddress, packageId]);

  useEffect(() => {
    return () => {
      stopPolling();
      blobUrlsRef.current.forEach(URL.revokeObjectURL);
      blobUrlsRef.current.clear();
    };
  }, []);

  const renderFile = (file: DecryptedFile, index: number) => {
    const { url, mimeType, textContent } = file;

    if (mimeType.startsWith('image/')) {
      return <img src={url} alt={`File ${index + 1}`} style={{ maxWidth: '100%', height: 'auto' }} />;
    } else if (
        mimeType === 'text/plain' ||
        mimeType === 'application/json' ||
        mimeType === 'text/html' ||
        mimeType.includes('javascript')
    ) {
      if (textContent === undefined) {
        return <Text size="2" color="gray">Loading content...</Text>;
      } else {
        return (
            <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  backgroundColor: '#fafafa',
                  padding: '10px',
                  borderRadius: '4px',
                  border: '1px solid #eee',
                  fontSize: '13px',
                  lineHeight: 1.4,
                  color: 'black',
                }}
            >
            {escapeHtml(textContent)}
          </pre>
        );
      }
    } else {
      return (
          <a
              href={url}
              download={`file-${index + 1}.${mimeType.split('/')[1] || 'bin'}`}
              style={{ textDecoration: 'none' }}
          >
            <Button variant="outline" size="2">
              Download File {index + 1} ({mimeType})
            </Button>
          </a>
      );
    }
  };

  return (
      <Card size="3">
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text size="2" weight="bold">Room ID：</Text>
            <Flex align="center" gap="2">
              <TextField.Root
                  placeholder="输入 Room ID（例如：0x...）"
                  value={roomId}
                  onChange={(e) => {
                    const val = e.target.value.trim();
                    setRoomId(val);
                  }}
                  style={{ flex: 1 }}
              />
              <Button
                  onClick={handleDecrypt}
                  disabled={!roomId || chatState.isDecrypting}
                  loading={chatState.isDecrypting}
              >
                解密
              </Button>
            </Flex>
          </Flex>

          <Card style={{ marginTop: '1rem' }}>
            <Text size="3" weight="bold">Room Message</Text>

            {/* ✅ 修复：移除 Card 的 color="red"，只保留 Text color */}
            {chatState.error && (
                <div style={{ marginTop: '8px' }}>
                  <Text color="red">{chatState.error}</Text>
                </div>
            )}

            {chatState.feed && (
                <Text size="2" mt="1">
                  Allowlist: {chatState.feed.allowlistName} (
                  <a
                      href={getObjectExplorerLink(chatState.feed.allowlistId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#007bff', textDecoration: 'underline' }}
                  >
                    {chatState.feed.allowlistId.slice(0, 8)}...
                  </a>
                  )
                </Text>
            )}

            {chatState.feed === null && !chatState.isDecrypting && !chatState.error && (
                <Text size="2" color="gray">输入 Room ID 并点击“解密”。</Text>
            )}

            {chatState.decryptedFiles.length > 0 && (
                <Flex direction="column" gap="3" mt="3">
                  <Text size="2" weight="medium">解密消息（按时间排序）：</Text>
                  {chatState.decryptedFiles.map((file, index) => (
                      <div
                          key={index}
                          style={{
                            padding: '12px',
                            background: 'rgba(245, 245, 245, 0.6)',
                            borderRadius: '8px',
                            border: '1px solid #eee',
                          }}
                      >
                        {renderFile(file, index)}
                      </div>
                  ))}
                </Flex>
            )}
          </Card>
        </Flex>
      </Card>
  );
};

export default Feeds;