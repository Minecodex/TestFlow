export const sdk = 'testflow.ui.v1';
export default function ConfigPanel({value,onChange,readonly,locale}) {
  const {React,HeroUI} = window.TestFlowHost;
  const {TextField,Label,Input,TextArea}=HeroUI;
  return React.createElement('div',{className:'testflow-stack'},Object.entries(value).map(([key,current])=>React.createElement(TextField,{key,className:'testflow-field',isDisabled:readonly,value:String(current),onChange:next=>onChange({...value,[key]:typeof current==='number'?Number(next):next})},React.createElement(Label,null,key),React.createElement(Input,{className:'testflow-input'}))));
}
