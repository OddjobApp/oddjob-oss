import { expect, test, describe } from 'vitest';
import { OKFSerializer } from '../../server/domain/knowledge/core/okf-serializer.js';

describe('OKFSerializer', () => {
    test('serializes a KnowledgeDocument correctly', () => {
        const doc = {
            title: 'Project Architecture',
            summary: 'Details about the backend architecture.',
            sourceType: 'upload',
            textContent: '# Architecture\n\nThis is the backend architecture.',
            createdAt: new Date('2026-07-14T00:00:00.000Z'),
            metadata: {
                type: 'architecture_doc',
                tags: ['backend', 'design']
            }
        };

        const okf = OKFSerializer.serialize(doc as any);

        expect(okf).toContain('---');
        expect(okf).toContain('title: Project Architecture');
        expect(okf).toContain('type: architecture_doc');
        expect(okf).toContain('description: Details about the backend architecture.');
        expect(okf).toContain('- backend');
        expect(okf).toContain('- design');
        expect(okf).toContain('# Architecture');
    });

    test('parses an OKF string correctly', () => {
        const okf = `---
title: System Overview
type: documentation
tags:
  - system
  - overview
timestamp: '2026-07-14T00:00:00.000Z'
---
# System Overview

Here is the system overview.`;

        const { frontmatter, content } = OKFSerializer.parse(okf);
        
        expect(frontmatter.title).toBe('System Overview');
        expect(frontmatter.type).toBe('documentation');
        expect(frontmatter.tags).toEqual(['system', 'overview']);
        expect(content).toContain('# System Overview');
    });
    
    test('handles parsing OKF string without frontmatter', () => {
        const okf = `# Just Markdown\n\nNo frontmatter here.`;
        
        const { frontmatter, content } = OKFSerializer.parse(okf);
        
        expect(frontmatter.title).toBe('Untitled Document');
        expect(content).toContain('# Just Markdown');
    });
});
