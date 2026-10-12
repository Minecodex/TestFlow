import {useState} from 'react';
import {Input,Label,TextField} from '@heroui/react';
import type {ModuleConfigPanelProps} from '@testflow/module-ui-sdk';
export const sdk='testflow.ui.v1';
export default function Panel({value,onChange,readonly}:ModuleConfigPanelProps){
 const [draft,setDraft]=useState(String(value.gain));
 return <TextField value={draft} isDisabled={readonly} onChange={text=>{setDraft(text);onChange({...value,gain:Number(text)});}}><Label>gain</Label><Input/></TextField>;
}
