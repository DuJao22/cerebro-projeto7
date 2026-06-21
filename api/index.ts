import type { Request, Response } from 'express';
import { createApp } from '../server.js';

let _app: any = null;

async function getApp() {
  if (!_app) {
    _app = await createApp();
  }
  return _app;
}

export default async function handler(req: Request, res: Response) {
  const app = await getApp();
  app(req, res);
}
