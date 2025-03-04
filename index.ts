import http from 'node:http';
import {
  createFederation
  , MemoryKvStore
} from "@fedify/fedify";

const federation
  = createFederation
    <void>({
      kv
        : new MemoryKvStore
          (),
    });