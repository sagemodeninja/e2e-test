const databaseName = 'e2e-storage';

interface SecretStore {
    id: number;
    name: string;
    value: ArrayBuffer;
    iv: Uint8Array;
}

class App {
    private readonly _usernameForm: HTMLFormElement;
    private readonly _usernameIpt: HTMLInputElement;
    private readonly _submitUsernameBtn: HTMLButtonElement;
    private readonly _pinForm: HTMLFormElement;
    private readonly _pinIpt: HTMLInputElement;
    private readonly _submitPinBtn: HTMLButtonElement;
    private readonly _secretForm: HTMLFormElement;
    private readonly _secretNameIpt: HTMLInputElement;
    private readonly _secretIpt: HTMLInputElement;
    private readonly _submitSecretBtn: HTMLButtonElement;
    private readonly _container: HTMLDivElement;

    private _db: IDBDatabase;
    private _username: string;
    private _key: CryptoKey;
    private _secrets: SecretStore[];

    constructor() {
        this._usernameForm = document.getElementById('usernameForm') as HTMLFormElement;
        this._usernameIpt = document.getElementById('username') as HTMLInputElement;
        this._submitUsernameBtn = document.getElementById('submitUsername') as HTMLButtonElement;

        this._pinForm = document.getElementById('pinForm') as HTMLFormElement;
        this._pinIpt = document.getElementById('pin') as HTMLInputElement;
        this._submitPinBtn = document.getElementById('submitPin') as HTMLButtonElement;

        this._secretForm = document.getElementById('secretForm') as HTMLFormElement;
        this._secretNameIpt = document.getElementById('secretName') as HTMLInputElement;
        this._secretIpt = document.getElementById('secret') as HTMLInputElement;
        this._submitSecretBtn = document.getElementById('submitSecret') as HTMLButtonElement;
        
        this._container = document.getElementById('dataContainer') as HTMLDivElement;

        this._secrets = [];
    }

    public async init() {
        this._db = await openIndexedDB(databaseName, 1)
        this._username = await this.fetchUser();
        this._key = await this.fetchKey();

        const transaction = this._db.transaction('secrets', 'readonly');
        const store = transaction.objectStore('secrets');
        const request = store.getAll();

        request.onerror = error => {
            console.log(error);
            alert('An error occured!');
        }

        request.onsuccess = async () => {
            this._secrets = request.result;
            
            const promises = this._secrets.map(async secret => {
                const p = document.createElement('p');
                // const value = await decryptData(this._key, secret.value, secret.iv);
                const decoder = new TextDecoder();
                const value = decoder.decode(secret.value);

                p.innerText = `${secret.id}: <b>${secret.name}</b> ${value}.`;

                return p;
            })

            try {
                const list = await Promise.all(promises);
            
                this._container.innerHTML = null;
                this._container.append(...list);
            } catch (error) {
                if (error.name === 'OperationError')
                    alert('Unable to decrypt data using the credentials provided!');
            }
        }

        this._submitSecretBtn.addEventListener('click', async () => {
            const name = this._secretNameIpt.value;
            const rawValue = this._secretIpt.value;

            if (name === '' || rawValue === '') return;

            const id = this._secrets.length + 1;
            const { ciphertext: value, iv } = await encryptData(this._key, rawValue);

            const secretStore: SecretStore = { id, name, value, iv }
            
            const transaction = this._db.transaction('secrets', 'readwrite');
            const store = transaction.objectStore('secrets');
            const putRequest = store.put(secretStore);

            putRequest.onsuccess = () => {
                this._secrets.push(secretStore);
            }

            putRequest.onerror = error => {
                alert('An error has occured! ' + error);
            }
        })
    }

    private async fetchUser() {
        return localStorage.getItem('auth_username') ?? await this.registerUser();
    }

    private async registerUser(): Promise<string> {
        return new Promise(resolve => {
            this._usernameForm.style.display = 'initial';

            this._submitUsernameBtn.addEventListener('click', () => {
                const user = this._usernameIpt.value;

                if (user === '') return;

                localStorage.setItem('auth_username', user);
                this._usernameForm.style.display = 'none';
                resolve(user);
            })
        })
    }

    private async fetchKey() {
        const pin = await new Promise<string>(resolve => {
            this._pinForm.style.display = 'initial';

            this._submitPinBtn.addEventListener('click', () => {
                const pin = this._pinIpt.value;

                if (pin === '' || pin.length !== 6) return;

                this._pinForm.style.display = 'none';
                this._secretForm.style.display = 'initial';
                resolve(pin);
            })
        })

        return await generatePBKDF2Key(pin, this._username, 10000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
})

async function openIndexedDB(name: string, version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);

        request.onerror = () => reject(request.error);
            
        request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.createObjectStore('secrets', { keyPath: 'name' });
            
            store.createIndex('name', 'name', { unique: true });
        }

        request.onsuccess = () => resolve(request.result);
    })
}

async function generatePBKDF2Key(password: string, salt: string, iterations: number) {
    try {
        const passwordBuffer = new TextEncoder().encode(password);
        const saltBuffer = new TextEncoder().encode(salt);

        // Derive the key using PBKDF2
        const importedKey = await window.crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveKey']);

        const keyOptions = {
            name: 'PBKDF2',
            salt: saltBuffer,
            iterations,
            hash: 'SHA-256',
        };

        return await window.crypto.subtle.deriveKey(
            keyOptions,
            importedKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    } catch (error) {
        console.error('Key generation error:', error);
    }
}

async function encryptData(key, data) {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);

    const iv = crypto.getRandomValues(new Uint8Array(12)); // Initialization Vector (IV)

    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
        },
        key,
        encodedData
    );

    return { ciphertext, iv };
}

async function decryptData(key: CryptoKey, ciphertext: ArrayBuffer, iv: Uint8Array) {
    const decryptedData = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
}