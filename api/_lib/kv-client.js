// Thin KV adapter.
//
// Production uses Vercel KV exactly as before. Tests opt into the in-memory
// implementation by setting KIDBUSTER_TEST_KV=1 before importing modules that
// use KV. This keeps the test double in committed source instead of relying on
// a hand-edited node_modules/@vercel/kv stub.

import { kv as vercelKv } from '@vercel/kv';

let memoryStore = new Map();
let outage = false;

function failIfOutage(){
  if(outage){
    throw new Error('Simulated KV outage');
  }
}

const memoryKv = {
  async get(key){
    failIfOutage();
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  },
  async set(key, value){
    failIfOutage();
    memoryStore.set(key, value);
  },
  async incr(key){
    failIfOutage();
    const current = memoryStore.has(key) ? Number(memoryStore.get(key)) : 0;
    const next = current + 1;
    memoryStore.set(key, next);
    return next;
  },
  async expire(){
    failIfOutage();
  }
};

export const kv = process.env.KIDBUSTER_TEST_KV === '1' ? memoryKv : vercelKv;

export function __resetForTests(){
  memoryStore = new Map();
  outage = false;
}

export function __simulateOutage(value){
  outage = !!value;
}
