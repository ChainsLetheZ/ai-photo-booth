import { Participant } from '../types';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

/**
 * Data access layer — swap Firebase config here when migrating to a new project.
 * All booth/wall pages should use DataService only, never import firebase directly.
 */
export interface IDataService {
  subscribe(callback: (participants: Participant[]) => void): () => void;
  monitorConnection(callback: (isConnected: boolean) => void): () => void;
  addParticipant(participant: Participant): Promise<void>;
  addParticipantsBatch(participants: Participant[]): Promise<void>;
  removeParticipant(id: string): Promise<void>;
  clearAll(): Promise<void>;
}

// --- CONFIGURATION ---
// ⚠️ 请务必使用您自己在 Firebase Console 中生成的配置覆盖下方内容 ⚠️
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDG-i1e5BqtuXKo3S7GhCPtF27rJEInzec",
  authDomain: "realtime-database-fd83a.firebaseapp.com",
  databaseURL: "https://realtime-database-fd83a-default-rtdb.firebaseio.com",
  projectId: "realtime-database-fd83a",
  storageBucket: "realtime-database-fd83a.firebasestorage.app",
  messagingSenderId: "269858958182",
  appId: "1:269858958182:web:d3fe06e690de322d3bb6a7",
  measurementId: "G-956SD0S9WC"
};

let db: any = null;
let connected = false;

try {
  // Prevent double initialization in React strict mode / hot reload
  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  } else {
    firebase.app(); // Ensure app is loaded
  }
  db = firebase.database();
  console.log("🔥 Firebase Initialized Successfully");
} catch (e) {
  console.error("Firebase init failed - check your config variable name and values:", e);
}

export const DataService = {
  
  /**
   * Monitor Connection Status
   */
  monitorConnection: (callback: (isConnected: boolean) => void) => {
    if (!db) {
        console.warn("DB not initialized - Check config in dataService.ts");
        callback(false);
        return () => {};
    }

    // Monitor special location .info/connected
    const connectedRef = db.ref(".info/connected");
    const listener = connectedRef.on('value', (snap: any) => {
      const isConnected = snap.val() === true;
      connected = isConnected;
      console.log(isConnected ? "✅ CONNECTED to Realtime DB" : "❌ DISCONNECTED from Realtime DB");
      callback(isConnected);
    });
    
    return () => connectedRef.off('value', listener);
  },

  /**
   * Subscribe to participant changes (Cloud Only)
   */
  subscribe: (callback: (participants: Participant[]) => void) => {
    if (!db) return () => {};

    const participantsRef = db.ref('participants');
    
    // Cloud Listener
    const listener = participantsRef.on('value', (snapshot: any) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.values(data) as Participant[];
        list.sort((a, b) => a.timestamp - b.timestamp);
        callback(list);
      } else {
        callback([]);
      }
    }, (error: any) => {
      console.error("FIREBASE READ ERROR:", error);
      if (error.message && error.message.includes("permission_denied")) {
          alert("Error: Database permissions denied. Check Firebase Console Rules.");
      } else if (error.message && error.message.includes("Client is offline")) {
          console.warn("Client offline");
      }
    });
    
    return () => participantsRef.off('value', listener);
  },

  /**
   * Add a single participant
   */
  addParticipant: async (participant: Participant) => {
    if (!db) {
        alert("Cannot upload: Database not connected.");
        return;
    }
    try {
      await db.ref(`participants/${participant.id}`).set(participant);
    } catch (e: any) {
      console.error("Upload failed", e);
      alert(`Upload Failed: ${e.message}`);
    }
  },

  /**
   * Add multiple participants (Batch)
   */
  addParticipantsBatch: async (participants: Participant[]) => {
    if (!db) return;
    try {
      const updates: Record<string, any> = {};
      participants.forEach(p => {
        updates[`participants/${p.id}`] = p;
      });
      await db.ref().update(updates);
    } catch (e: any) {
      console.error("Batch upload failed", e);
      alert(`Batch Upload Failed: ${e.message}`);
    }
  },

  /**
   * Remove a participant
   */
  removeParticipant: async (id: string) => {
    if (!db) return;
    try {
      await db.ref(`participants/${id}`).remove();
    } catch (e) {
      console.error("Delete failed", e);
    }
  },

  /**
   * Clear all data
   */
  clearAll: async () => {
    if (!db) return;
    if(confirm("Are you sure you want to delete ALL photos from the cloud? This impacts all screens.")) {
        try {
            await db.ref('participants').set(null);
        } catch (e) {
            console.error("Clear failed", e);
        }
    }
  }
} satisfies IDataService;
