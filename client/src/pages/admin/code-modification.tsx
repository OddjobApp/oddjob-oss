"use client";

import { useState, useEffect } from 'react';
import { 
  Code, GitBranch, Save, RotateCcw, Eye, Edit3, Trash2, 
  AlertTriangle, Shield, History, Sparkles, FileText, CheckCircle 
} from 'lucide-react';

interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
}

interface AuditEntry {
  id: string;
  action: string;
  details: string;
  timestamp: string;
  userId: string;
}

export default function CodeModificationPage() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [gitStatus, setGitStatus] = useState<string>('');
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [diffContent, setDiffContent] = useState<string>('');
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'diff' | 'history' | 'audit'>('editor');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    checkPermissions();
    loadGitStatus();
    loadAuditLog();
  }, []);

  const checkPermissions = async () => {
    try {
      const res = await fetch('/api/admin/check-permissions');
      const data = await res.json();
      setIsSuperAdmin(data.isSuperAdmin || false);
    } catch (err) {
      console.error('Failed to check permissions', err);
    }
  };

  const loadGitStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/code-modification/code-status');
      const data = await res.json();
      setGitStatus(data.status || '');
      setCurrentBranch(data.branch || 'main');
    } catch (err) {
      showNotification('error', 'Failed to load git status');
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLog = async () => {
    try {
      const res = await fetch('/api/admin/code-modification/audit-log?filter=self_modification');
      const data = await res.json();
      setAuditLog(data.entries || []);
    } catch (err) {
      console.error('Failed to load audit log', err);
    }
  };

  const loadFileContent = async (filePath: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/code-modification/code-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      const data = await res.json();
      setFileContent(data.content || '');
      setSelectedFile(filePath);
    } catch (err) {
      showNotification('error', 'Failed to load file content');
    } finally {
      setLoading(false);
    }
  };

  const loadDiff = async (filePath?: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/code-modification/code-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
      const data = await res.json();
      setDiffContent(data.diff || '');
      setActiveTab('diff');
    } catch (err) {
      showNotification('error', 'Failed to load diff');
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/admin/code-modification/code-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedFile,
          oldContent: fileContent,
          newContent: fileContent,
          commitMessage: `Edit ${selectedFile} via admin dashboard`,
        }),
      });
      
      const data = await res.json();
      if (data.success) {
        showNotification('success', 'File saved successfully');
        loadGitStatus();
      } else {
        showNotification('error', data.message || 'Failed to save file');
      }
    } catch (err) {
      showNotification('error', 'Failed to save file');
    } finally {
      setLoading(false);
    }
  };

  const rollbackFile = async () => {
    if (!selectedFile) return;
    
    if (!confirm('Are you sure you want to rollback this file? This will undo all uncommitted changes.')) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/code-modification/code-rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedFile,
          confirm: true,
        }),
      });
      
      const data = await res.json();
      if (data.success) {
        showNotification('success', 'File rolled back successfully');
        loadGitStatus();
        loadFileContent(selectedFile);
      } else {
        showNotification('error', data.message || 'Failed to rollback file');
      }
    } catch (err) {
      showNotification('error', 'Failed to rollback file');
    } finally {
      setLoading(false);
    }
  };

  const aiRefactor = async (instruction: string) => {
    if (!selectedFile) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/admin/code-modification/ai-refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedFile,
          instruction,
        }),
      });
      
      const data = await res.json();
      if (data.success) {
        setFileContent(data.content || '');
        showNotification('success', 'AI refactoring applied');
      } else {
        showNotification('error', data.message || 'Failed to refactor code');
      }
    } catch (err) {
      showNotification('error', 'Failed to refactor code');
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-card text-foreground flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-16 h-16 text-rose-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">Super admin permissions required to access code modification tools.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-card text-foreground p-6">
      {/* Header */}
      <div className="mb-8 border-b border-border pb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
              <Code className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Code Modification Dashboard</h1>
              <p className="text-muted-foreground text-sm">Super Admin Only • Self-Modification Tools</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <span className="text-foreground">{currentBranch}</span>
            </div>
            <button
              onClick={loadGitStatus}
              className="px-4 py-2 bg-muted hover:bg-accent rounded-lg text-sm transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-amber-400 font-medium text-sm">Danger Zone</p>
          <p className="text-amber-700 dark:text-amber-300/80 text-xs mt-1">
            These tools allow direct modification of the Oddjob codebase. All changes are logged, backed up, and committed to Git. Use with extreme caution.
          </p>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-rose-500/10 border border-rose-500/30'
        }`}>
          {notification.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400" />
          )}
          <span className={`text-sm ${
            notification.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {notification.message}
          </span>
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="space-y-4">
          {/* Git Status */}
          <div className="bg-muted rounded-xl p-4 border border-border">
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Git Status
            </h3>
            <pre className="text-xs text-muted-foreground bg-background p-3 rounded-lg overflow-auto max-h-48">
              {gitStatus || 'No changes'}
            </pre>
          </div>

          {/* Quick Actions */}
          <div className="bg-muted rounded-xl p-4 border border-border">
            <h3 className="text-sm font-medium text-foreground mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => loadDiff()}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted hover:bg-accent rounded-lg text-sm transition-colors"
              >
                <Eye className="w-4 h-4" />
                View Full Diff
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted hover:bg-accent rounded-lg text-sm transition-colors"
              >
                <History className="w-4 h-4" />
                View History
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted hover:bg-accent rounded-lg text-sm transition-colors"
              >
                <Shield className="w-4 h-4" />
                Audit Log
              </button>
            </div>
          </div>

          {/* AI Refactor */}
          <div className="bg-muted rounded-xl p-4 border border-border">
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              AI Refactoring
            </h3>
            <select
              onChange={(e) => aiRefactor(e.target.value)}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm"
              disabled={!selectedFile}
            >
              <option value="">Select refactoring...</option>
              <option value="improve performance">Improve Performance</option>
              <option value="add error handling">Add Error Handling</option>
              <option value="improve readability">Improve Readability</option>
              <option value="add comments">Add Comments</option>
              <option value="modernize syntax">Modernize Syntax</option>
            </select>
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2 border-b border-border pb-2">
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'editor' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              <Edit3 className="w-4 h-4 inline mr-2" />
              Editor
            </button>
            <button
              onClick={() => loadDiff(selectedFile || undefined)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'diff' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              <Eye className="w-4 h-4 inline mr-2" />
              Diff
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'history' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              <History className="w-4 h-4 inline mr-2" />
              History
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'audit' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted'
              }`}
            >
              <Shield className="w-4 h-4 inline mr-2" />
              Audit Log
            </button>
          </div>

          {/* Editor Tab */}
          {activeTab === 'editor' && (
            <div className="bg-muted rounded-xl border border-border overflow-hidden">
              {/* File Path Input */}
              <div className="p-4 border-b border-border flex gap-2">
                <input
                  type="text"
                  value={selectedFile || ''}
                  onChange={(e) => setSelectedFile(e.target.value)}
                  placeholder="Enter file path (e.g., server/domain/tools/v1/capabilities/files.ts)"
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
                <button
                  onClick={() => selectedFile && loadFileContent(selectedFile)}
                  disabled={!selectedFile}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-muted disabled:text-muted-foreground rounded-lg text-sm transition-colors"
                >
                  Load
                </button>
              </div>

              {/* Code Editor */}
              <div className="relative">
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-96 bg-background text-foreground p-4 font-mono text-sm resize-none"
                  placeholder="File content will appear here..."
                />
                {!selectedFile && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center text-muted-foreground">
                      <FileText className="w-8 h-8 mx-auto mb-2" />
                      <p>Enter a file path and click Load to edit</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Bar */}
              <div className="p-4 border-t border-border flex justify-between items-center">
                <div className="flex gap-2">
                  <button
                    onClick={saveFile}
                    disabled={!selectedFile || loading}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-muted disabled:text-muted-foreground rounded-lg text-sm transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={rollbackFile}
                    disabled={!selectedFile || loading}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-muted disabled:text-muted-foreground rounded-lg text-sm transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Rollback
                  </button>
                </div>
                <div className="text-xs text-muted-foreground">
                  {fileContent.length} characters
                </div>
              </div>
            </div>
          )}

          {/* Diff Tab */}
          {activeTab === 'diff' && (
            <div className="bg-muted rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="text-sm font-medium text-foreground">Git Diff</h3>
              </div>
              <pre className="p-4 text-xs text-foreground bg-background overflow-auto max-h-96 font-mono">
                {diffContent || 'No changes to display'}
              </pre>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="bg-muted rounded-xl border border-border p-4">
              <h3 className="text-sm font-medium text-foreground mb-4">Git History</h3>
              <p className="text-muted-foreground text-sm">Git history view would be implemented here</p>
            </div>
          )}

          {/* Audit Log Tab */}
          {activeTab === 'audit' && (
            <div className="bg-muted rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="text-sm font-medium text-foreground">Audit Log</h3>
              </div>
              <div className="max-h-96 overflow-auto">
                {auditLog.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Shield className="w-8 h-8 mx-auto mb-2" />
                    <p>No audit entries found</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-card">
                      <tr>
                        <th className="px-4 py-2 text-left text-muted-foreground">Action</th>
                        <th className="px-4 py-2 text-left text-muted-foreground">Details</th>
                        <th className="px-4 py-2 text-left text-muted-foreground">User</th>
                        <th className="px-4 py-2 text-left text-muted-foreground">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLog.map((entry) => (
                        <tr key={entry.id} className="border-b border-border">
                          <td className="px-4 py-2 text-foreground">{entry.action}</td>
                          <td className="px-4 py-2 text-muted-foreground">{entry.details}</td>
                          <td className="px-4 py-2 text-muted-foreground">{entry.userId}</td>
                          <td className="px-4 py-2 text-muted-foreground text-xs">{entry.timestamp}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
