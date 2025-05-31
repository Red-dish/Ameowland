async function getUserRole() {
    try {
        const response = await fetch('/api/settings/role');
        if (!response.ok) {
            console.error('Failed to fetch role:', response.status, response.statusText);
            const errorData = await response.json();
            console.error('Error details:', errorData);
            return 'user';
        }
        const data = await response.json();
        return data.role;
    } catch (error) {
        console.error('Error fetching user role:', error);
        return 'user';
    }
}

async function setUserRoleClass() {
    const userRole = await getUserRole();
    console.log('User role:', userRole);
    document.body.classList.add(userRole);
}

document.addEventListener('DOMContentLoaded', setUserRoleClass);

setUserRoleClass();

export { getUserRole };