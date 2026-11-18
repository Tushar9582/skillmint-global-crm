
import {one} from './db';
import {withTenantScope} from './tenant-scope';
export type CompanyProfile={display_name:string;legal_name:string;industry:string;website:string;contact_email:string;phone:string;address:string;city:string;state:string;postal_code:string;country:string;tax_id:string;registration_number:string;description:string;has_logo:boolean;updated_at:string|null};
export async function companyProfile(org:string):Promise<CompanyProfile|null>{
 return withTenantScope(org,()=>one<CompanyProfile>(`SELECT coalesce(p.display_name,o.name) display_name,coalesce(p.legal_name,'') legal_name,coalesce(p.industry,'') industry,coalesce(p.website,'') website,coalesce(p.contact_email,'') contact_email,coalesce(p.phone,'') phone,coalesce(p.address,'') address,coalesce(p.city,'') city,coalesce(p.state,'') state,coalesce(p.postal_code,'') postal_code,coalesce(p.country,'') country,coalesce(p.tax_id,'') tax_id,coalesce(p.registration_number,'') registration_number,coalesce(p.description,'') description,(p.logo_base64 IS NOT NULL) has_logo,p.updated_at FROM organizations o LEFT JOIN hrdiary_company_profiles p ON p.organization_id=o.id WHERE o.id=$1`,[org]));
}
