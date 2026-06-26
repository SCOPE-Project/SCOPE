function [rv] = kep2rv(kep)
% kep2rv converts Keplerian elements into position and velocity in ECI.
%
% Syntax:  
%   [rv] = kep2rv(kep)
% 
% Inputs:
%   kep - [m,6], [double], Keplerian element sets with mean anomaly
%
% Outputs:
%   rv - [m,6], [type], Position and velocity in ECI system

% References:
%   [1] D.A. Vallado, Fundamentals of Astrodynamics and Applications, 4th ed., Microcosm Press, Hawthorne, CA, USA, 2013.
%
% Implemented in Matlab R2025a.
% 2025 Institute of Space Systems, University of Stuttgart.

    arguments
        kep
    end
    
    %% 
    c = constants;

    a       = kep(:,1);
    e       = kep(:,2);
    i       = kep(:,3);
    RAAN    = kep(:,4);
    w       = kep(:,5);
    M       = kep(:,6);

    theta = M2theta(M, e);

    p = a .* (1-(e.^2));
    
    r_norm = p./(1+e.*cos(theta));
    
    r_pf = r_norm .* [cos(theta), sin(theta), zeros(size(theta))];
    
    v_pf = sqrt(c.MU_E./p) .* [-sin(theta), e+cos(theta), zeros(size(theta))];
    
    cosRAAN=cos(RAAN); cosw=cos(w); cosi=cos(i);
    sinRAAN=sin(RAAN); sinw=sin(w); sini=sin(i);
    
    r_pf_reshaped = permute(r_pf, [2 3 1]);  
    v_pf_reshaped = permute(v_pf, [2 3 1]);  
    
    R = [permute(cosRAAN.*cosw-sinRAAN.*sinw.*cosi, [2 3 1]), permute(-cosRAAN.*sinw-sinRAAN.*cosw.*cosi, [2 3 1]),  permute(sinRAAN.*sini, [2 3 1]);...
        permute(sinRAAN.*cosw+cosRAAN.*sinw.*cosi, [2 3 1]),  permute(-sinRAAN.*sinw+cosRAAN.*cosw.*cosi, [2 3 1]), permute(-cosRAAN.*sini, [2 3 1]);...
        permute(sinw.*sini, [2 3 1]),                        permute(cosw.*sini, [2 3 1]),                       permute(cosi, [2 3 1])];

    r_ECI_pages = pagemtimes(R,r_pf_reshaped);
    v_ECI_pages = pagemtimes(R,v_pf_reshaped);

    r_ECI = squeeze(r_ECI_pages)';
    v_ECI = squeeze(v_ECI_pages)'; 

    rv = [r_ECI, v_ECI];
end