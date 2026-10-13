from testflow.core.contracts import PodRuntime
from testflow.features.evaluation.service import MISSING,bind,rule,declared_media
from testflow.infrastructure.models import Execution
import pytest


def test_json_null_is_material_and_structure_uses_declared_fields():
    ex=Execution(snapshot={'reference':{'result':None},'reference_confirmed':True},output={'result':None},actual_inputs={})
    assert bind(ex,{'source':'output','field':'result'}) is None
    assert bind(ex,{'source':'output','field':'absent'}) is MISSING
    field={'name':'result','type':'JSON','format':'application/json','stream':False}
    dimension={'method':'structure','actual':{'source':'output','field':'result'},'bound_schema':{'fields':[field]}}
    assert rule(dimension,None,None)[0]==1
    dimension['actual']['field']=''
    assert rule(dimension,{'result':None},None)[0]==1
    assert rule(dimension,{'unexpected':None},None)[0]==0


def test_truncated_stream_cannot_supply_bound_material_and_zero_limits_rejected():
    ex=Execution(snapshot={},output={'text':{'stream':True,'text':'complete-looking text','eos':False}},actual_inputs={})
    assert bind(ex,{'source':'output','field':'text'}) is MISSING
    for invalid in [{'cpu':'0'},{'memory':'0Mi'}]:
        with pytest.raises(ValueError):PodRuntime(image='test/example:immutable',**invalid)


def test_json_stream_property_is_data_and_complete_group_normalizes_streams():
    schema={'fields':[{'name':'text','type':'Text','stream':True},{'name':'stats','type':'JSON','stream':False}]}
    ex=Execution(snapshot={'pipeline':{'graph':{'output_schema':schema}}},actual_inputs={},output={'text':{'stream':True,'eos':True,'text':'result'},'stats':{'stream':True,'eos':False,'count':1}})
    assert bind(ex,{'source':'output','field':'stats'})=={'stream':True,'eos':False,'count':1}
    assert bind(ex,{'source':'output','field':''})['text']=='result'
    assert rule({'method':'exact_json'},True,1)[0]==0


def test_media_is_bound_by_declared_fields_including_reference():
    reference = {'asset_id': 'an-id', 'asset_version': 1}
    schema = {'fields': [{'name': 'claims', 'type': 'JSON', 'stream': False},
                         {'name': 'image', 'type': 'Image', 'stream': False}]}
    ex = Execution(snapshot={'pipeline': {'graph': {'output_schema': schema}}})
    material = {'claims': reference, 'image': reference}
    assert declared_media(ex, {'source': 'output', 'field': 'claims'}, reference) == []
    assert declared_media(ex, {'source': 'output', 'field': ''}, material) == [('Image', reference)]
    assert declared_media(ex, {'source': 'reference', 'field': 'image'}, reference) == [('Image', reference)]
    assert declared_media(ex, {'source': 'events', 'field': ''}, material) == []
