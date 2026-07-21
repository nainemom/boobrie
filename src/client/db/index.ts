import Dexie, { type Table } from 'dexie';

export const db = new Dexie('boobrie') as Dexie & {
	auth: Table<CryptoKeyPair, string>;
};

db.version(1).stores({
	auth: '',
});
