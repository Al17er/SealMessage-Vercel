// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useNetworkVariable } from './networkConfig';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Button, Card, Flex, Spinner, Text, TextArea } from '@radix-ui/themes';
import { SealClient } from '@mysten/seal';

export type Data = {
  status: string;
  blobId: string;
  endEpoch: string;
  suiRefType: string;
  suiRef: string;
  suiBaseUrl: string;
  blobUrl: string;
  suiUrl: string;
  isImage: string;
};

interface WalrusUploadProps {
  policyObject: string;
  cap_id: string;
  moduleName: string;
}

type WalrusService = {
  id: string;
  name: string;
  publisherUrl: string;
  aggregatorUrl: string;
};

export function WalrusUpload({ policyObject, cap_id, moduleName }: WalrusUploadProps) {
  const [text, setText] = useState<string>('');
  const [info, setInfo] = useState<Data | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [selectedService, setSelectedService] = useState<string>('service1');

  const SUI_VIEW_TX_URL = `https://suiscan.xyz/testnet/tx`;
  const SUI_VIEW_OBJECT_URL = `https://suiscan.xyz/testnet/object`;

  const NUM_EPOCH = 10;
  const packageId = useNetworkVariable('packageId');
  const suiClient = useSuiClient();
  const serverObjectIds = [
    "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
    "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8"
  ];

  const client = new SealClient({
    suiClient,
    serverConfigs: serverObjectIds.map((id) => ({
      objectId: id,
      weight: 1,
    })),
    verifyKeyServers: false,
  });

  const services: WalrusService[] = [
    { id: 'service1', name: 'walrus.space', publisherUrl: 'https://publisher.walrus.space', aggregatorUrl: 'https://aggregator.walrus.space' },
    { id: 'service2', name: 'staketab.org', publisherUrl: 'https://walrus-publisher.staketab.org', aggregatorUrl: 'https://walrus-aggregator.staketab.org' },
    { id: 'service3', name: 'redundex.com', publisherUrl: 'https://walrus.redundex.com/publisher', aggregatorUrl: 'https://walrus.redundex.com/aggregator' },
    { id: 'service4', name: 'nodes.guru', publisherUrl: 'https://walrus.nodes.guru/publisher', aggregatorUrl: 'https://walrus.nodes.guru/aggregator' },
    { id: 'service5', name: 'banansen.dev', publisherUrl: 'https://walrus.banansen.dev/publisher', aggregatorUrl: 'https://walrus.banansen.dev/aggregator' },
    { id: 'service6', name: 'everstake.one', publisherUrl: 'https://walrus.everstake.one/publisher', aggregatorUrl: 'https://walrus.everstake.one/aggregator' },
  ];

  function getAggregatorUrl(path: string): string {
    const service = services.find((s) => s.id === selectedService);
    if (!service) return '';
    const cleanPath = path.replace(/^\/+/, '').replace(/^v1\//, '');
    return `${service.aggregatorUrl}/v1/${cleanPath}`;
  }

  function getPublisherUrl(path: string): string {
    const service = services.find((s) => s.id === selectedService);
    if (!service) return '';
    const cleanPath = path.replace(/^\/+/, '').replace(/^v1\//, '');
    return `${service.publisherUrl}/v1/${cleanPath}`;
  }

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

  const storeBlob = (encryptedData: Uint8Array) => {
    // ✅ 修复：将 Uint8Array 转为 ArrayBuffer 以满足 BodyInit 类型要求
    return fetch(`${getPublisherUrl(`/blobs?epochs=${NUM_EPOCH}`)}`, {
      method: 'PUT',
      body: encryptedData.slice(), // Uint8Array is valid BodyInit!
    }).then(async (response) => {
      if (response.ok) {
        return response.json(); // This is the storage_info object directly
      } else {
        const text = await response.text();
        throw new Error(`Walrus upload failed (${response.status}): ${text}`);
      }
    });
  };

  const displayUpload = (storage_info: any) => {
    let info;
    if ('alreadyCertified' in storage_info) {
      info = {
        status: 'Already certified',
        blobId: storage_info.alreadyCertified.blobId,
        endEpoch: storage_info.alreadyCertified.endEpoch,
        suiRefType: 'Previous Sui Certified Event',
        suiRef: storage_info.alreadyCertified.event.txDigest,
        suiBaseUrl: SUI_VIEW_TX_URL,
        blobUrl: getAggregatorUrl(`/blobs/${storage_info.alreadyCertified.blobId}`),
        suiUrl: `${SUI_VIEW_TX_URL}/${storage_info.alreadyCertified.event.txDigest}`,
        isImage: 'false',
      };
    } else if ('newlyCreated' in storage_info) {
      info = {
        status: 'Newly created',
        blobId: storage_info.newlyCreated.blobObject.blobId,
        endEpoch: storage_info.newlyCreated.blobObject.storage.endEpoch,
        suiRefType: 'Associated Sui Object',
        suiRef: storage_info.newlyCreated.blobObject.id,
        suiBaseUrl: SUI_VIEW_OBJECT_URL,
        blobUrl: getAggregatorUrl(`/blobs/${storage_info.newlyCreated.blobObject.blobId}`),
        suiUrl: `${SUI_VIEW_OBJECT_URL}/${storage_info.newlyCreated.blobObject.id}`,
        isImage: 'false',
      };
    } else {
      throw new Error('Unhandled successful response from Walrus!');
    }
    setInfo(info);
  };

  const handleSend = async () => {
    if (!text.trim()) {
      alert('Please enter some text to upload.');
      return;
    }

    if (!policyObject || !cap_id || !moduleName) {
      alert('Missing required parameters (policyObject, cap_id, or moduleName).');
      return;
    }

    setIsProcessing(true);
    setInfo(null);

    try {
      // Step 1: Add timestamp and encode
      const now = new Date().toISOString();
      const messageWithTimestamp = `[${now}] ${text.trim()}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(messageWithTimestamp);

      // Generate a unique ID (SealClient requires a string ID)
      const id = crypto.randomUUID();

      const { encryptedObject: encryptedBytes } = await client.encrypt({
        threshold: 2,
        packageId,
        id,
        data,
      });

      // Step 2: Upload to Walrus
      const storageResult = await storeBlob(encryptedBytes);
      displayUpload(storageResult);

      // Step 3: Publish blob ID to Sui
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::${moduleName}::publish`,
        arguments: [
          tx.object(policyObject),
          tx.object(cap_id),
          tx.pure.string(
              storageResult.newlyCreated?.blobObject.blobId ??
              storageResult.alreadyCertified.blobId
          ),
        ],
      });
      tx.setGasBudget(10000000);

      await new Promise<void>((resolve, reject) => {
        signAndExecute(
            { transaction: tx },
            {
              onSuccess: () => {
                console.log('Publish transaction succeeded');
                resolve();
              },
              onError: (error) => {
                console.error('Publish transaction failed:', error);
                alert('Failed to link message to Sui object. Check console for details.');
                reject(error);
              },
            }
        );
      });

    } catch (err: any) {
      console.error('Full send process failed:', err);
      let msg = 'An unexpected error occurred during encryption or upload.';
      if (err.message?.includes('Walrus upload failed')) {
        msg = 'Failed to upload to Walrus. Please try a different service or check your network.';
      }
      alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
      <Card>
        <Flex direction="column" gap="2" align="start">
          <Flex gap="2" align="center">
            <Text>Select Walrus service:</Text>
            <select
                value={selectedService}
                onChange={(e) => setSelectedService(e.target.value)}
                aria-label="Select Walrus service"
            >
              {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
              ))}
            </select>
          </Flex>

          <TextArea
              placeholder="Enter text to encrypt and send..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              style={{ width: '100%' }}
              aria-label="Text to send"
          />
          <p>Text will be encrypted, uploaded to Walrus, and linked to the Sui object.</p>

          <Button
              onClick={handleSend}
              disabled={!text.trim() || isProcessing}
          >
            {isProcessing ? 'Sending...' : 'Send'}
          </Button>

          {isProcessing && (
              <Flex gap="2" align="center">
                <Spinner size="2" />
                <Text size="2">Encrypting, uploading, and publishing... (may take a few seconds)</Text>
              </Flex>
          )}

          {info && (
              <div id="uploaded-blobs" role="region" aria-label="Upload details">
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px' }}>
                  <dt>Status:</dt>
                  <dd>{info.status}</dd>

                  <dt>Blob:</dt>
                  <dd>
                    <a
                        href={info.blobUrl}
                        onClick={(e) => {
                          e.preventDefault();
                          window.open(info.blobUrl, '_blank', 'noopener,noreferrer');
                        }}
                        style={{ textDecoration: 'underline', color: 'var(--accent-11)' }}
                    >
                      View encrypted blob
                    </a>
                  </dd>

                  <dt>Sui:</dt>
                  <dd>
                    <a
                        href={info.suiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'underline', color: 'var(--accent-11)' }}
                    >
                      View on Explorer
                    </a>
                  </dd>
                </dl>
              </div>
          )}
        </Flex>
      </Card>
  );
}

export default WalrusUpload;