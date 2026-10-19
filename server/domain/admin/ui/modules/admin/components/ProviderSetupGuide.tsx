import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Alert, AlertDescription } from '@domain-ui/core/ui/components/ui/alert';
import { ExternalLink, Key, Info } from 'lucide-react';
import { Button } from '@domain-ui/core/ui/components/ui/button';

interface ProviderSetupGuideProps {
  provider: 'openai' | 'anthropic' | 'google';
}

export function ProviderSetupGuide({ provider }: ProviderSetupGuideProps) {
  const guides = {
    openai: {
      name: 'OpenAI',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      docsUrl: 'https://platform.openai.com/docs/quickstart',
      steps: [
        'Go to the OpenAI Platform and sign in',
        'Navigate to API Keys section',
        'Click "Create new secret key"',
        'Give it a descriptive name (e.g., "Odd Job Production")',
        'Copy the API key (you won\'t be able to see it again!)',
        'Paste the API key into Secret below',
      ],
      additionalInfo: [
        'Organization ID is optional but recommended for team accounts',
        'API keys can be rate-limited based on your OpenAI plan',
        'Monitor usage at platform.openai.com/usage',
      ],
    },
    anthropic: {
      name: 'Anthropic Claude',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys',
      docsUrl: 'https://docs.anthropic.com/claude/reference/getting-started',
      steps: [
        'Go to the Anthropic Console and sign in',
        'Navigate to Settings → API Keys',
        'Click "Create Key"',
        'Give it a descriptive name',
        'Copy the API key immediately',
        'Paste the API key into Secret below',
      ],
      additionalInfo: [
        'Claude API requires a paid plan or credits',
        'Different models have different context windows and capabilities',
        'Monitor usage in the Anthropic Console',
      ],
    },
    google: {
      name: 'Google Gemini',
      apiKeyUrl: 'https://aistudio.google.com/app/apikey',
      docsUrl: 'https://ai.google.dev/tutorials/setup',
      steps: [
        'Go to Google AI Studio and sign in',
        'Click "Get API key" in the navigation',
        'Create a new API key (or use existing project)',
        'Copy the generated API key',
        'Paste the API key into Secret below',
      ],
      additionalInfo: [
        'Gemini API has a generous free tier',
        'Project ID is optional for most use cases',
        'API version defaults to v1 if not specified',
      ],
    },
  };

  const guide = guides[provider];

  return (
    <Card className="border-primary/20">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle>
          {guide.name} Setup Guide
        </CardTitle>
        <CardDescription>
          Follow these steps to get your API key and configure the credential
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Your API key is stored encrypted for your organization and is never shown again.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          <h4 className="font-medium flex items-center gap-2">
            <Key className="h-4 w-4" />
            Step-by-Step Instructions
          </h4>
          <ol className="space-y-2 text-sm">
            {guide.steps.map((step, index) => (
              <li key={index} className="flex gap-2">
                <span className="font-semibold text-primary min-w-6">{index + 1}.</span>
                <span className={index === guide.steps.length - 1 ? 'font-medium text-primary' : ''}>
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              asChild
              data-testid={`link-${provider}-api-keys`}
            >
              <a href={guide.apiKeyUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Get API Key
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              data-testid={`link-${provider}-docs`}
            >
              <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                View Documentation
              </a>
            </Button>
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t">
          <h4 className="font-medium text-sm">Good to Know</h4>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {guide.additionalInfo.map((info, index) => (
              <li key={index} className="flex gap-2">
                <span>•</span>
                <span>{info}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
