
import React from 'react';

export const HatIcons = {
    // Image Asset Wrappers
    GraduationCap: (props: any) => <img src="/hats/hat-grad.png" alt="Graduation Cap" {...props} />,
    CowboyHat: (props: any) => <img src="/hats/hat-cowboy.png" alt="Cowboy Hat" {...props} />,
    PirateHat: (props: any) => <img src="/hats/hat-pirate.png" alt="Pirate Hat" {...props} />,
    BowlerHat: (props: any) => <img src="/hats/hat-bowler.png" alt="Bowler Hat" {...props} />,
    Hair: (props: any) => <img src="/hats/hat-hair.png" alt="Trump Hair" {...props} />,
};

export const HAT_OPTIONS = [
    { id: 'hat-bowler', label: 'Bowler', component: HatIcons.BowlerHat },
    { id: 'hat-hair', label: 'The Don', component: HatIcons.Hair },
    { id: 'hat-cowboy', label: 'Cowboy', component: HatIcons.CowboyHat },
    { id: 'hat-pirate', label: 'Pirate', component: HatIcons.PirateHat },
    { id: 'hat-grad', label: 'Graduate', component: HatIcons.GraduationCap },
];
