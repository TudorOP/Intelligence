export const workspaceSchema = `
  CREATE TABLE IF NOT EXISTS chat_files(id TEXT PRIMARY KEY,storage TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chat_file_refs(conversation TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(conversation,id));
  CREATE TABLE IF NOT EXISTS file_watches(task TEXT PRIMARY KEY,source TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS file_queue(id TEXT PRIMARY KEY,task TEXT NOT NULL,source TEXT NOT NULL,identity TEXT NOT NULL,file TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL,seen INTEGER NOT NULL,updated INTEGER NOT NULL,result TEXT,run TEXT,UNIQUE(task,source,identity));
  CREATE INDEX IF NOT EXISTS file_queue_task ON file_queue(task,state);
  CREATE TABLE IF NOT EXISTS run_profiles(run TEXT PRIMARY KEY,profile TEXT,name TEXT,provider TEXT,model TEXT);
`;
