import React from 'react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({request:vi.fn(),select:vi.fn(),input:vi.fn()}));
vi.mock('../../server/blueprints/apps/incident-response-workbench/lib/platform-client',()=>({incidentRequest:mocks.request,retryKey:()=> 'incident-test-retry'}));
vi.mock('../../server/blueprints/apps/incident-response-workbench/lib/crew-sdk',()=>({setSelectedRecord:mocks.select,requestCrewInput:mocks.input}));
import IncidentResponse from '../../server/blueprints/apps/incident-response-workbench/pages/index';
describe('incident coordination surface',()=>{
  beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mocks.request.mockReset();mocks.request.mockResolvedValue({items:[],nextCursor:null});});
  it('has no invented incident, deployment or recovery outcome',async()=>{
    render(<IncidentResponse/>);
    expect(await screen.findByText('No incidents recorded in this room.')).toBeTruthy();
    expect(screen.queryByRole('button',{name:/deploy|rollback/i})).toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('retains the command identity after an unknown response',async()=>{
    const commands:any[]=[];
    mocks.request.mockImplementation(async(method,body)=>{if(method==='POST'){commands.push(body);throw new Error('Connection interrupted');}return {items:[],nextCursor:null};});
    render(<IncidentResponse/>);
    fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Test declaration'}});
    fireEvent.change(screen.getByLabelText('Observed impact'),{target:{value:'Isolated acceptance test'}});
    fireEvent.click(screen.getByRole('button',{name:'Declare incident'}));
    fireEvent.click(await screen.findByRole('button',{name:'Retry saved command'}));
    await waitFor(()=>expect(commands).toHaveLength(2));
    expect(commands[0].requestId).toBe(commands[1].requestId);
    expect((screen.getByRole('button',{name:'Declare incident'}) as HTMLButtonElement).disabled).toBe(true);
  });
});
