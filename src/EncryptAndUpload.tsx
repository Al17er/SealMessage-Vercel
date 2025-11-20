// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useNetworkVariable } from './networkConfig';
import { useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Button, Card, Flex, Spinner, Text, TextArea } from '@radix-ui/themes';
import { SealClient } from '@mysten/seal';
import { fromHex, toHex } from '@mysten/sui/utils';

export type Data = {
  status: string;
  blobId: string;
  endEpoch: string;
  suiRefType: string;
  suiRef: string;
  suiBaseUrl: string;
  blobUrl: string;
  suiUrl: string;
  isImage: string; // 可保留，但始终为 "false"
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
    { id: 'service1', name: 'walrus.space', publisherUrl: '/publisher1', aggregatorUrl: '/aggregator1' },
    { id: 'service2', name: 'staketab.org', publisherUrl: '/publisher2', aggregatorUrl: '/aggregator2' },
    { id: 'service3', name: 'redundex.com', publisherUrl: '/publisher3', aggregatorUrl: '/aggregator3' },
    { id: 'service4', name: 'nodes.guru', publisherUrl: '/publisher4', aggregatorUrl: '/aggregator4' },
    { id: 'service5', name: 'banansen.dev', publisherUrl: '/publisher5', aggregatorUrl: '/aggregator5' },
    { id: 'service6', name: 'everstake.one', publisherUrl: '/publisher6', aggregatorUrl: '/aggregator6' },
  ];

  function getAggregatorUrl(path: string): string {
    const service = services.find((s) => s.id === selectedService);
    const cleanPath = path.replace(/^\/+/, '').replace(/^v1\//, '');
    return `${service?.aggregatorUrl}/v1/${cleanPath}`;
  }

  function getPublisherUrl(path: string): string {
    const service = services.find((s) => s.id === selectedService);
    const cleanPath = path.replace(/^\/+/, '').replace(/^v1\//, '');
    return `${service?.publisherUrl}/v1/${cleanPath}`;
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
    return fetch(`${getPublisherUrl(`/v1/blobs?epochs=${NUM_EPOCH}`)}`, {
      method: 'PUT',
      body: encryptedData.slice(),
    }).then((response) => {
      if (response.status === 200) {
        return response.json().then((info) => ({ info }));
      } else {
        throw new Error('Failed to publish blob to Walrus.');
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
        blobUrl: getAggregatorUrl(`/v1/blobs/${storage_info.alreadyCertified.blobId}`),
        suiUrl: `${SUI_VIEW_OBJECT_URL}/${storage_info.alreadyCertified.event.txDigest}`,
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
        blobUrl: getAggregatorUrl(`/v1/blobs/${storage_info.newlyCreated.blobObject.blobId}`),
        suiUrl: `${SUI_VIEW_OBJECT_URL}/${storage_info.newlyCreated.blobObject.id}`,
        isImage: 'false',
      };
    } else {
      throw Error('Unhandled successful response!');
    }
    setInfo(info);
  };

  const handleSend = async () => {
    if (!text.trim()) {
      alert('Please enter some text to upload.');
      return;
    }
    // if (!policyObject || !cap_id || !moduleName) {
    //   alert('Missing required parameters (policyObject, cap_id, or moduleName).');
    //   return;
    // }

    setIsProcessing(true);
    setInfo(null); // Clear previous result

    try {
      // Step 1: Add current timestamp and encode the message
      const now = new Date().toISOString(); // e.g., "2025-11-13T10:30:45.123Z"
      const messageWithTimestamp = `[${now}] ${text.trim()}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(messageWithTimestamp);

      const nonce = crypto.getRandomValues(new Uint8Array(5));
      const policyObjectBytes = fromHex(policyObject);
      const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));

      const { encryptedObject: encryptedBytes } = await client.encrypt({
        threshold: 2,
        packageId,
        id,
        data,
      });

      // Step 2: Upload to Walrus
      const storageResult = await storeBlob(encryptedBytes);
      displayUpload(storageResult.info);

      // Step 3: Publish blob ID to Sui object
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::${moduleName}::publish`,
        arguments: [
          tx.object(policyObject),
          // tx.object(cap_id),
          tx.pure.string(
              storageResult.info.newlyCreated?.blobObject.blobId ??
              storageResult.info.alreadyCertified.blobId
          ),
        ],
      });
      tx.setGasBudget(10000000);

      await new Promise<void>((resolve, reject) => {
        signAndExecute(
            { transaction: tx as any },
            {
              onSuccess: (result) => {
                console.log('Publish transaction succeeded:', result);
                // alert('Message sent successfully! The encrypted content is now associated with the Sui object.');
                resolve();
              },
              onError: (error) => {
                console.error('Publish transaction failed:', error);
                alert('Failed to associate message with Sui object. Please try again.');
                reject(error);
              },
            }
        );
      });
    } catch (err: any) {
      console.error('Full send process failed:', err);
      let msg = 'An unexpected error occurred.';
      if (err.message?.includes('publish blob')) {
        msg = 'Failed to upload encrypted data to Walrus. Please try a different service.';
      } else if (err.message?.includes('Encryption')) {
        msg = 'Encryption failed. Please try again.';
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
              <div role="status">
                <Spinner className="animate-spin" aria-label="Processing" />
                <span>Encrypting, uploading, and publishing... (may take a few seconds)</span>
              </div>
          )}

          {info && (
              <div id="uploaded-blobs" role="region" aria-label="Upload details">
                <dl>
                  <dt>Status:</dt>
                  <dd>{info.status}</dd>
                  <dd>
                    <a
                        href={info.blobUrl}
                        style={{ textDecoration: 'underline' }}
                        onClick={(e) => {
                          e.preventDefault();
                          window.open(info.blobUrl, '_blank', 'noopener,noreferrer');
                        }}
                        aria-label="View encrypted blob"
                    >
                      Encrypted blob
                    </a>
                  </dd>
                  <dd>
                    <a
                        href={info.suiUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'underline' }}
                        aria-label="View Sui object details"
                    >
                      Sui Object
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