import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as monaco from 'monaco-editor';

interface UseMonacoEditorProps {
  language?: string;
  value?: string;
  onChange?: (value: string) => void;
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  readOnly?: boolean;
  theme?: 'light' | 'dark';
}

export const useMonacoEditor = ({
  language = 'json',
  value = '',
  onChange,
  onMount,
  options = {},
  readOnly = false,
  theme = 'dark'
}: UseMonacoEditorProps = {}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Load Monaco Editor
    import('monaco-editor').then(monacoInstance => {
      if (!editorRef.current) {
        const editor = monacoInstance.editor.create(document.getElementById('monaco-editor')!, {
          value,
          language,
          theme: theme === 'dark' ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: true,
          readOnly,
          fontSize: 14,
          lineNumbers: 'on',
          wordWrap: 'on',
          folding: true,
          bracketPairColorization: { enabled: true },
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          ...options
        });

        editorRef.current = editor;

        // Add change listener
        if (onChange) {
          editor.onDidChangeModelContent(() => {
            const newValue = editor.getValue();
            onChange(newValue);
          });
        }

        // Add mount callback
        if (onMount) {
          onMount(editor);
        }

        setIsLoaded(true);
      }
    }).catch(error => {
      console.error('Failed to load Monaco Editor:', error);
    });

    // Cleanup
    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  return {
    editor: editorRef.current,
    isLoaded,
    updateValue: (newValue: string) => {
      if (editorRef.current) {
        editorRef.current.setValue(newValue);
      }
    },
    focus: () => {
      if (editorRef.current) {
        editorRef.current.focus();
      }
    }
  };
};
