// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Transaction } from '@mysten/sui/transactions';
import {
  Button,
  Card,
  Flex,
  Heading,
  TextField,
  Text,
  Link as RadixLink,
} from '@radix-ui/themes';
import { useSignAndExecuteTransaction, useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { useState, useCallback, useEffect } from 'react';
import { useNetworkVariable } from './networkConfig';
import {getObjectExplorerLink, getObjectExplorerUrl} from './utils';

// 类型定义
interface Cap {
  id: string;
  allowlist_id: string;
}

interface CardItem {
  cap_id: string;
  allowlist_id: string;
  list: string[];
  name: string;
}

export function CreateAllowlist() {
  const currentAccount = useCurrentAccount();
  const suiClient = useSuiClient();
  const packageId = useNetworkVariable('packageId');

  const [name, setName] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [cardItems, setCardItems] = useState<CardItem[]>([]);

  const { mutate: signAndExecute } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) =>
        await suiClient.executeTransactionBlock({
          transactionBlock: bytes,
          signature,
          options: {
            showRawEffects: true,
            showEffects: true,
          },
        }),
  });

  // 🔁 获取用户拥有的所有 allowlist（房间）
  const fetchAllowlists = useCallback(async () => {
    if (!currentAccount?.address) {
      setCardItems([]);
      return;
    }

    try {
      const res = await suiClient.getOwnedObjects({
        owner: currentAccount.address,
        options: { showContent: true, showType: true },
        filter: { StructType: `${packageId}::allowlist::Cap` },
      });

      const caps = res.data
          .map((obj) => {
            if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') return null;
            const fields = (obj.data.content as any).fields;
            return {
              id: fields?.id?.id,
              allowlist_id: fields?.allowlist_id,
            };
          })
          .filter((item): item is Cap => item !== null && !!item.id && !!item.allowlist_id);

      const cardItems: CardItem[] = await Promise.all(
          caps.map(async (cap) => {
            const allowlist = await suiClient.getObject({
              id: cap.allowlist_id,
              options: { showContent: true },
            });
            const content = allowlist.data?.content;
            const fields = content && 'fields' in content ? content.fields : {};
            return {
              cap_id: cap.id,
              allowlist_id: cap.allowlist_id,
                name: (fields as any).name || 'Unnamed Room',
                list: Array.isArray((fields as any).list) ? (fields as any).list : [],
            };
          })
      );

      setCardItems(cardItems);
    } catch (err) {
      console.error('Failed to fetch allowlists:', err);
      setCardItems([]);
    }
  }, [currentAccount?.address, packageId]);

  // 🔄 初始加载 + 账户变化时刷新
  useEffect(() => {
    fetchAllowlists();
  }, [fetchAllowlists]);

  // ✨ 创建房间
  async function createAllowlist(roomName: string) {
    const trimmed = roomName.trim();
    if (!trimmed) {
      alert('Please enter a valid room name');
      return;
    }

    if (isPending) return;
    setIsPending(true);

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::allowlist::create_allowlist_entry`,
        arguments: [tx.pure.string(trimmed)],
      });
      tx.setGasBudget(10000000);

      signAndExecute(
          { transaction: tx as any},
          {
            onSuccess: () => {
              // ✅ 创建成功后刷新列表并清空输入
              fetchAllowlists();
              setName('');
            },
            onError: (error) => {
              console.error('Create room failed:', error);
              alert('Failed to create room. Please check console for details.');
            },
            onSettled: () => setIsPending(false),
          }
      );
    } catch (err) {
      console.error('Unexpected error:', err);
      setIsPending(false);
      alert('An unexpected error occurred.');
    }
  }

  return (
      <Flex direction="column" gap="5">
        {/* 创建表单 */}
        <Card size="3">
          <Heading size="4" mb="3">
            Create a New Chat Room
          </Heading>
          <Flex direction="column" gap="3">
            <TextField.Root
                placeholder="Room Name (e.g., Project Alpha)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
            />
            <Flex gap="2" align="center">
              <Button
                  size="3"
                  onClick={() => createAllowlist(name)}
                  loading={isPending}
                  disabled={!name.trim()}
              >
                {isPending ? 'Creating...' : 'Create Room'}
              </Button>
            </Flex>
          </Flex>
        </Card>

        {/* 房间列表 */}
        <Card size="3">
          <Heading size="4" mb="3">
            Your Rooms ({cardItems.length})
          </Heading>
          {cardItems.length === 0 ? (
              <Text color="gray">You haven't created any rooms yet.</Text>
          ) : (
              <Flex direction="column" gap="3">
                {cardItems.map((item) => (
                    <Card key={item.allowlist_id} size="2">
                      <Flex justify="between" align="center" wrap="wrap" gap="3">
                        <div>
                          <Text weight="bold">{item.name}</Text>
                          <Text size="2" color="gray">
                            ID: <RadixLink href={getObjectExplorerUrl(item.allowlist_id)} target="_blank" rel="noopener noreferrer">
                              {item.allowlist_id.slice(0, 10)}...
                          </RadixLink>
                          </Text>
                        </div>
                        <Flex gap="2" wrap="wrap">
                          <Button
                              size="2"
                              variant="soft"
                              color="blue"
                              onClick={() => {
                                window.open(
                                    `${window.location.origin}/CreateRoom/admin/allowlist/${item.allowlist_id}`,
                                    '_blank'
                                );
                              }}
                          >
                            Enter
                          </Button>
                          {/*<Button*/}
                          {/*    size="2"*/}
                          {/*    variant="soft"*/}
                          {/*    color="green"*/}
                          {/*    onClick={() => {*/}
                          {/*      window.open(*/}
                          {/*          `${window.location.origin}/CreateRoom/view/allowlist/${item.allowlist_id}`,*/}
                          {/*          '_blank'*/}
                          {/*      );*/}
                          {/*    }}*/}
                          {/*>*/}
                          {/*  Enter*/}
                          {/*</Button>*/}
                        </Flex>
                      </Flex>
                    </Card>
                ))}
              </Flex>
          )}
        </Card>
      </Flex>
  );
}