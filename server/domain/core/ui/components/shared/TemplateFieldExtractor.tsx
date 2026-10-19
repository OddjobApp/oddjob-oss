import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Separator } from "@domain-ui/core/ui/components/ui/separator";
import {
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  Edit3,
  Save,
  X,
  Loader2
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

interface ExtractedField {
  name: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'boolean';
  label: string;
  required: boolean;
  options?: string[];
  defaultValue?: string;
  aiConfidence: number; // 0-1, how confident the AI is
  userVerified?: boolean;
  userModifications?: Partial<ExtractedField>;
}

interface TemplateFieldExtractorProps {
  templateId: number;
  templateContent: string;
  onFieldsExtracted: (fields: ExtractedField[]) => void;
  onFieldsVerified: (fields: ExtractedField[]) => void;
  initialFields?: any[];
}

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Single Line Text' },
  { value: 'textarea', label: 'Multi-line Text' },
  { value: 'select', label: 'Dropdown Selection' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes/No' }
];

export default function TemplateFieldExtractor({
  templateId,
  templateContent,
  onFieldsExtracted,
  onFieldsVerified,
  initialFields
}: TemplateFieldExtractorProps) {
  const { toast } = useToast();
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([]);
  const [editingField, setEditingField] = useState<number | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  // Extract fields from template content
  const extractFieldsFromTemplate = async () => {
    if (!templateContent) return;

    setExtractedFields([]); // Clear current fields to show loading/refreshing
    setIsExtracting(true);
    try {
      const response = await apiRequest('POST', '/api/form-agents/extract-fields', {
        templateId,
        templateContent
      });

      const data = await response.json();
      // Handle standard response wrapper { success: true, data: { fields: [] } } 
      // or direct { fields: [] }
      const fields: ExtractedField[] = data.data?.fields || data.fields || [];

      console.log('[TemplateFieldExtractor] Extracted fields:', fields);

      setExtractedFields(fields);
      onFieldsExtracted(fields);

      toast({
        title: "Fields Extracted",
        description: `Found ${fields.length} potential form fields. Please review and verify.`,
      });
    } catch (error: any) {
      toast({
        title: "Field Extraction Failed",
        description: error.message || "Failed to extract fields from template",
        variant: "destructive",
      });
    } finally {
      setIsExtracting(false);
    }
  };

  // Auto-extract fields when template content changes
  useEffect(() => {
    // If we have initial fields, use them instead of auto-extracting
    if (initialFields && initialFields.length > 0 && !extractedFields.length) {
      console.log('[TemplateFieldExtractor] Initializing with existing fields:', initialFields);
      const mappedFields: ExtractedField[] = initialFields.map(f => ({
        name: f.key || f.name, // Handle both 'key' and 'name' formats
        type: f.type,
        label: f.label,
        required: f.required,
        options: f.options,
        defaultValue: f.defaultValue,
        aiConfidence: 1.0, // Existing fields are considered verified/confident
        userVerified: true
      }));
      setExtractedFields(mappedFields);
      return;
    }

    if (templateContent && !extractedFields.length && !isExtracting) {
      extractFieldsFromTemplate();
    }
  }, [templateContent, templateId, initialFields]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-green-600";
    if (confidence >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getConfidenceIcon = (confidence: number, verified?: boolean) => {
    if (verified) return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (confidence >= 0.8) return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (confidence >= 0.6) return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    return <AlertTriangle className="w-4 h-4 text-red-600" />;
  };

  const handleFieldEdit = (index: number) => {
    setEditingField(index);
  };

  const handleFieldSave = (index: number, updatedField: Partial<ExtractedField>) => {
    const newFields = [...extractedFields];
    newFields[index] = {
      ...newFields[index],
      ...updatedField,
      userVerified: true,
      userModifications: updatedField
    };
    setExtractedFields(newFields);
    setEditingField(null);
  };

  const handleFieldCancel = () => {
    setEditingField(null);
  };

  const handleVerifyAllFields = () => {
    const verifiedFields = extractedFields.map(field => ({
      ...field,
      userVerified: true
    }));
    setExtractedFields(verifiedFields);
    onFieldsVerified(verifiedFields);

    toast({
      title: "Fields Verified",
      description: "All form fields have been verified and are ready for use.",
    });
  };

  const addCustomField = () => {
    const newField: ExtractedField = {
      name: `custom_field_${extractedFields.length + 1}`,
      type: 'text',
      label: 'Custom Field',
      required: false,
      aiConfidence: 1.0,
      userVerified: true
    };
    setExtractedFields([...extractedFields, newField]);
  };

  const removeField = (index: number) => {
    const newFields = extractedFields.filter((_, i) => i !== index);
    setExtractedFields(newFields);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            Form Field Extraction
          </h4>
          <p className="text-xs text-muted-foreground">
            AI-powered analysis of your document template to identify form fields
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={addCustomField}
            disabled={isExtracting}
          >
            Add Custom Field
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={extractFieldsFromTemplate}
            disabled={isExtracting}
          >
            {isExtracting ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Lightbulb className="w-3 h-3 mr-1" />
            )}
            Re-extract Fields
          </Button>
        </div>
      </div>

      {extractedFields.length === 0 && !isExtracting && (
        <Card>
          <CardContent className="text-center py-6">
            <Lightbulb className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Click "Extract Fields" to analyze your document template and identify form fields.
            </p>
          </CardContent>
        </Card>
      )}

      {extractedFields.length > 0 && (
        <>
          <div className="space-y-3">
            {extractedFields.map((field, index) => (
              <Card key={index} className="border-l-4 border-l-blue-200">
                <CardContent className="pt-4">
                  {editingField === index ? (
                    <FieldEditor
                      field={field}
                      onSave={(updates) => handleFieldSave(index, updates)}
                      onCancel={handleFieldCancel}
                    />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {getConfidenceIcon(field.aiConfidence, field.userVerified)}
                          <span className="font-medium">{field.label}</span>
                          <Badge variant="outline" className="text-xs">
                            {field.type}
                          </Badge>
                          {field.required && (
                            <Badge variant="destructive" className="text-xs">
                              Required
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs ${getConfidenceColor(field.aiConfidence)}`}>
                            {Math.round(field.aiConfidence * 100)}% confidence
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleFieldEdit(index)}
                          >
                            <Edit3 className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeField(index)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {field.options && field.options.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Options: {field.options.join(', ')}
                        </div>
                      )}

                      {field.defaultValue && (
                        <div className="text-xs text-muted-foreground">
                          Default: {field.defaultValue}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Separator />

          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {extractedFields.filter(f => f.userVerified).length} of {extractedFields.length} fields verified
            </div>
            <Button
              onClick={handleVerifyAllFields}
              disabled={extractedFields.some(f => !f.userVerified)}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Verify All Fields
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Field Editor Component
interface FieldEditorProps {
  field: ExtractedField;
  onSave: (updates: Partial<ExtractedField>) => void;
  onCancel: () => void;
}

function FieldEditor({ field, onSave, onCancel }: FieldEditorProps) {
  const [editedField, setEditedField] = useState<Partial<ExtractedField>>({
    name: field.name,
    type: field.type,
    label: field.label,
    required: field.required,
    options: field.options || [],
    defaultValue: field.defaultValue
  });

  const handleSave = () => {
    onSave(editedField);
  };

  const addOption = () => {
    setEditedField(prev => ({
      ...prev,
      options: [...(prev.options || []), '']
    }));
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...(editedField.options || [])];
    newOptions[index] = value;
    setEditedField(prev => ({ ...prev, options: newOptions }));
  };

  const removeOption = (index: number) => {
    const newOptions = (editedField.options || []).filter((_, i) => i !== index);
    setEditedField(prev => ({ ...prev, options: newOptions }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Field Name</Label>
          <input
            type="text"
            value={editedField.name || ''}
            onChange={(e) => setEditedField(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-3 py-2 border rounded-md text-sm"
            placeholder="field_name"
          />
        </div>
        <div className="space-y-2">
          <Label>Field Type</Label>
          <Select
            value={editedField.type || 'text'}
            onValueChange={(value: any) => setEditedField(prev => ({ ...prev, type: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Display Label</Label>
        <input
          type="text"
          value={editedField.label || ''}
          onChange={(e) => setEditedField(prev => ({ ...prev, label: e.target.value }))}
          className="w-full px-3 py-2 border rounded-md text-sm"
          placeholder="Field display label"
        />
      </div>

      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="required"
          checked={editedField.required || false}
          onChange={(e) => setEditedField(prev => ({ ...prev, required: e.target.checked }))}
        />
        <Label htmlFor="required" className="text-sm">Required field</Label>
      </div>

      {editedField.type === 'select' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Options</Label>
            <Button variant="outline" size="sm" onClick={addOption}>
              Add Option
            </Button>
          </div>
          {(editedField.options || []).map((option, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={option}
                onChange={(e) => updateOption(index, e.target.value)}
                className="flex-1 px-3 py-2 border rounded-md text-sm"
                placeholder="Option value"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeOption(index)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Label>Default Value (Optional)</Label>
        <input
          type="text"
          value={editedField.defaultValue || ''}
          onChange={(e) => setEditedField(prev => ({ ...prev, defaultValue: e.target.value }))}
          className="w-full px-3 py-2 border rounded-md text-sm"
          placeholder="Default value for this field"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="w-3 h-3 mr-1" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave}>
          <Save className="w-3 h-3 mr-1" />
          Save Changes
        </Button>
      </div>
    </div>
  );
}

