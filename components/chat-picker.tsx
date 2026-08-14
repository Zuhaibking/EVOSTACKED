import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  getModelGroupLabel,
  LLMModel,
  LLMModelConfig,
  MODEL_GROUP_ORDER,
} from '@/lib/model-catalog'
import { getTemplateId, Templates } from '@/lib/templates'
import 'core-js/features/object/group-by.js'
import { Sparkles } from 'lucide-react'
import Image from 'next/image'

export function ChatPicker({
  templates,
  selectedTemplate,
  onSelectedTemplateChange,
  models,
  languageModel,
  onLanguageModelChange,
}: {
  templates: Templates
  selectedTemplate: string
  onSelectedTemplateChange: (template: string) => void
  models: LLMModel[]
  languageModel: LLMModelConfig
  onLanguageModelChange: (config: LLMModelConfig) => void
}) {
  const modelsByGroup = Object.groupBy(models, (model) =>
    getModelGroupLabel(model),
  )

  return (
    <div className="flex items-center space-x-2">
      <div className="flex flex-col">
        <Select
          name="template"
          defaultValue={selectedTemplate}
          onValueChange={onSelectedTemplateChange}
        >
          <SelectTrigger className="whitespace-nowrap border-none shadow-none focus:ring-0 px-0 py-0 h-6 text-xs">
            <SelectValue placeholder="Select a persona" />
          </SelectTrigger>
          <SelectContent side="top">
            <SelectGroup>
              <SelectLabel>Persona</SelectLabel>
              <SelectItem value="auto">
                <div className="flex items-center space-x-2">
                  <Sparkles
                    className="flex text-[#a1a1aa]"
                    width={14}
                    height={14}
                  />
                  <span>Auto</span>
                </div>
              </SelectItem>
              {Object.entries(templates).map(([templateId, template]) => (
                <SelectItem key={templateId} value={templateId}>
                  <div className="flex items-center space-x-2">
                    <Image
                      className="flex"
                      src={`/thirdparty/templates/${getTemplateId(
                        templateId,
                      )}.svg`}
                      alt={templateId}
                      width={14}
                      height={14}
                    />
                    <span>{template.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col">
        <Select
          name="languageModel"
          defaultValue={languageModel.model}
          onValueChange={(e) => onLanguageModelChange({ model: e })}
        >
          <SelectTrigger className="whitespace-nowrap border-none shadow-none focus:ring-0 px-0 py-0 h-6 text-xs">
            <SelectValue placeholder="Language model" />
          </SelectTrigger>
          <SelectContent>
            {MODEL_GROUP_ORDER.map((group) => {
              const groupModels = modelsByGroup[group]
              if (!groupModels?.length) return null
              return (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {groupModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center space-x-2">
                        <Image
                          className="flex"
                          src={`/thirdparty/logos/${model.providerId}.svg`}
                          alt={model.provider}
                          width={14}
                          height={14}
                        />
                        <span>{model.name}</span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {group}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
