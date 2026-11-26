import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LLMModel, LLMModelConfig } from '@/lib/models'
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
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <div className="flex min-w-0 shrink-0 flex-col">
        <Select
          name="template"
          value={selectedTemplate}
          onValueChange={onSelectedTemplateChange}
        >
          <SelectTrigger aria-label="App framework" className="h-8 w-auto min-w-0 max-w-[132px] justify-start gap-1 rounded-md border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground data-[state=open]:text-foreground [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0">
            <SelectValue placeholder="App framework" />
          </SelectTrigger>
          <SelectContent side="top">
            <SelectGroup>
              <SelectLabel>App framework</SelectLabel>
              <SelectItem value="auto">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Sparkles
                    className="flex shrink-0 text-muted-foreground"
                    width={14}
                    height={14}
                  />
                  <span className="truncate">Auto</span>
                </div>
              </SelectItem>
              {Object.entries(templates).map(([templateId, template]) => (
                <SelectItem key={templateId} value={templateId}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Image
                      className="flex shrink-0"
                      src={`/thirdparty/templates/${getTemplateId(
                        templateId,
                      )}.svg`}
                      alt={templateId}
                      width={14}
                      height={14}
                    />
                    <span className="truncate">{template.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 shrink flex-col">
        <Select
          name="languageModel"
          value={languageModel.model}
          onValueChange={(e) => onLanguageModelChange({ model: e })}
        >
          <SelectTrigger aria-label="Language model" className="h-8 w-auto min-w-0 max-w-[168px] justify-start gap-1 rounded-md border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent hover:text-foreground data-[state=open]:text-foreground [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0">
            <SelectValue placeholder="Language model" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(
              Object.groupBy(models, ({ provider }) => provider),
            ).map(([provider, models]) => (
              <SelectGroup key={provider}>
                <SelectLabel>{provider}</SelectLabel>
                {models?.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Image
                        className="flex shrink-0"
                        src={`/thirdparty/logos/${model.providerId}.svg`}
                        alt={model.provider}
                        width={14}
                        height={14}
                      />
                      <span className="truncate">{model.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
