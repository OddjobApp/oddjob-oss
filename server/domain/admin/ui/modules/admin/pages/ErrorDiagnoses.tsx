import { DiagnosisList } from '../components/diagnoses/DiagnosisList.js';

export default function ErrorDiagnoses() {
    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Error Diagnoses</h1>
                    <p className="text-muted-foreground">
                        Review AI-generated diagnoses and root-cause analysis for system errors.
                    </p>
                </div>
            </div>

            <DiagnosisList />
        </div>
    );
}
